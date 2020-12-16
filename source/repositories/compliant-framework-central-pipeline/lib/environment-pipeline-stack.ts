/**********************************************************************************************************************
 *  Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.                                           *
 *                                                                                                                    *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance    *
 *  with the License. A copy of the License is located at                                                             *
 *                                                                                                                    *
 *      http://www.apache.org/licenses/LICENSE-2.0                                                                    *
 *                                                                                                                    *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES *
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
 *  and limitations under the License.                                                                                *
 *********************************************************************************************************************/

import * as cdk from '@aws-cdk/core';

import * as codecommit from '@aws-cdk/aws-codecommit';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as codepipeline_actions from '@aws-cdk/aws-codepipeline-actions';
import * as iam from '@aws-cdk/aws-iam';
import { CfnCapabilities } from '@aws-cdk/core';

import * as cfw from './pipeline-base';

/**
 *
 */
export class EnvironmentPipelineStack extends cfw.PipelineStackBase {

  /**
   *
   */
  constructor(scope: cdk.Construct, id: string, props: cfw.PipelineStackProps) {
    super(scope, id, props);

    this.initializeRepos();
    this.createPipeline();
    this.updateGrants();
  }


  /**
   * Initializes source objects based on the config.
   *
   * Creates references to all the CodeCommit repositories in use by this
   * pipeline. Plugin repositories are dynamically detected and added to the
   * list based on the inputted config.json
   */
  private initializeRepos() {
    this.sources = {} // Initialize list

    let repoName = cfw.TRANSIT_CORE
    let resourceId = 'rTransitCore'
    this.sources[repoName] = {
      repo: codecommit.Repository.fromRepositoryName(this, resourceId,
        `compliant-framework-${repoName}`),
      output: new codepipeline.Artifact()
    }

    repoName = cfw.MANAGEMENT_SERVICES_CORE
    resourceId = 'rManagementServicesCoreRepo'
    this.sources[repoName] = {
      repo: codecommit.Repository.fromRepositoryName(this, resourceId,
        `compliant-framework-${repoName}`),
      output: new codepipeline.Artifact()
    }

    repoName = cfw.SECURITY_BASELINE
    resourceId = 'rSecurityBaselineRepo'
    this.sources[repoName] = {
      repo: codecommit.Repository.fromRepositoryName(this, resourceId,
        `compliant-framework-${repoName}`),
      output: new codepipeline.Artifact()
    }

    //
    // Add Plugins
    //
    for (var item in this.props.config.plugins) {
      repoName = 'plugin-' + item
      resourceId = 'rPlugin' + item.replace(/-/gi, '').toUpperCase()
      this.sources[repoName] = {
        repo: codecommit.Repository.fromRepositoryName(this, resourceId,
          `compliant-framework-${repoName}`),
        output: new codepipeline.Artifact()
      }
    }
  }

  /**
   * Defines the CodePipeline
   */
  private createPipeline() {

    var stageOutputs: {
      [name: string]: codepipeline.Artifact;
    } = {}

    const pipeline = new codepipeline.Pipeline(this, 'rPipeline', {
      pipelineName: `compliant-framework-${this.props.pipelineName}`,
      artifactBucket: this.s3Bucket,
    });

    this.lambdas[cfw.COPY_CODECOMMIT_REPOSITORIES_TO_S3].grantInvoke(pipeline.role)

    if (this.props.environment.startsWith('alpha')) {
      pipeline.addStage({
        stageName: 'Source',
        actions: this.getAlphaSourceActions()
      });
      pipeline.addStage({
        stageName: 'Deploy-ExpandS3Sources',
        actions: this.getExpandS3SourcesActions()
      });
    }
    else {
      pipeline.addStage({
        stageName: 'Source',
        actions: this.getSourceActions()
      });
      pipeline.addStage({
        stageName: 'Deploy-CopySourceToS3',
        actions: this.getCopySourceToS3Actions()
      });
    }

    pipeline.addStage({
      stageName: 'Deploy-InitializeOrgUnits',
      actions: this.getInitializeOrganizationalUnitsActions()
    });

    var environmentActions = this.getEnvironmentActions(stageOutputs)
    pipeline.addStage({
      stageName: 'Deploy-Environment',
      actions: environmentActions
    });

    pipeline.addStage({
      stageName: 'Deploy-SecurityBaseline',
      actions: this.getSecurityBaselineActions()
    });

    for (var item in this.props.config.plugins) {
      var stageName = 'Deploy-Plugin-' + item.toUpperCase()
      var actions: codepipeline.IAction[] = this.getPluginActions(item, stageOutputs, environmentActions)
      pipeline.addStage({
        stageName,
        actions
      });
    }

    if (this.props.config.federation.enabled) {
      pipeline.addStage({
        stageName: 'Deploy-FederationSupport',
        actions: this.getFederationSupportActions()
      });
    }

  }

  /**
   * Configures the alpha stage source actions to trigger the pipeline from
   * S3. See deploy_to_alpha.bash
   */
  private getAlphaSourceActions(): codepipeline.IAction[] {
    var actions: codepipeline.IAction[] = []
    for (var source in this.sources) {
      actions.push(
        new codepipeline_actions.S3SourceAction({
          actionName: source,
          bucket: this.s3Bucket,
          bucketKey: this.sources[source].repo.repositoryName + '.zip',
          output: this.sources[source].output
        })
      )
    }
    return actions
  }

  /**
   * Expands the zip files into S3
   */
  private getExpandS3SourcesActions(): codepipeline.IAction[] {
    var actions: codepipeline.IAction[] = []
    for (var source in this.sources) {
      actions.push(
        new codepipeline_actions.LambdaInvokeAction({
          actionName: source,
          lambda: this.lambdas['expand_s3_sources'],
          userParameters: {
            'bucketName': this.s3Bucket.bucketName,
            'kmsKeyId': this.s3BucketCmkAlias.keyId,
            'repositoryName': this.sources[source].repo.repositoryName,
            'branchName': this.props.pipelineName
          },
          inputs: [
            this.sources[source].output,
          ],
          runOrder: 1,
        }),
      )
    }
    return actions
  }

  /**
   * Generates the CodePipeline source actions.
   *
   * A list of codepipeline.IAction is generated based on the sources list
   * that was generated in the constructor by initializeRepos().
   */
  private getSourceActions(): codepipeline.IAction[] {
    var actions: codepipeline.IAction[] = []
    for (var source in this.sources) {
      actions.push(
        new codepipeline_actions.CodeCommitSourceAction({
          actionName: source,
          repository: this.sources[source].repo,
          branch: this.props.pipelineName,
          output: this.sources[source].output
        })
      )
    }
    return actions
  }

  /**
   *
   */
  private getCopySourceToS3Actions(): codepipeline.IAction[] {
    var actions: codepipeline.IAction[] = []
    for (var source in this.sources) {
      actions.push(
        new codepipeline_actions.LambdaInvokeAction({
          actionName: source,
          lambda: this.lambdas[cfw.COPY_CODECOMMIT_REPOSITORIES_TO_S3],
          userParameters: {
            'bucketName': this.s3Bucket.bucketName,
            'kmsKeyId': this.s3BucketCmkAlias.keyId,
            'repositoryNames': [
              this.sources[source].repo.repositoryName,
            ],
            'branchName': this.props.pipelineName
          },
          inputs: [
            this.sources[source].output,
          ],
          runOrder: 1,
        }),
      )
    }
    return actions
  }

  /**
   *
   */
  private getInitializeOrganizationalUnitsActions(): codepipeline.IAction[] {

    let actions: codepipeline.IAction[] = []

    for (const region of this.props.config.deployToRegions) {
      let coreAccounts: string[] = []

      // Transit Account
      if (region in this.props.config.transit) {
        let transitAccountId =
          this.props.config.transit[region]
            .environments[this.props.environment].accountId
        coreAccounts.push(transitAccountId)
      }

      // Management Services
      if (region in this.props.config.managementServices) {
        let managementServicesAccountId =
          this.props.config.managementServices[region]
            .environments[this.props.environment].accountId
        coreAccounts.push(managementServicesAccountId)
      }

      let tenantAccounts: string[] = []

      // All the Plugins
      for (var plugin in this.props.config.plugins) {
        if (region in this.props.config.plugins[plugin]) {
          for (var action of this.props.config.plugins[plugin][region].actions) {
            var accountId = action.environments[this.props.environment].accountId

            // Add the account to the list only if it's not a core account
            if (!tenantAccounts.includes(accountId) &&
              !coreAccounts.includes(accountId) &&
              accountId != this.props.config.central.accountId &&
              accountId != this.props.config.logging.accountId) {
              tenantAccounts.push(accountId)
            }
          }
        }
      }

      actions.push(
        new codepipeline_actions.LambdaInvokeAction({
          actionName: `initializeOrgUnits-${cfw.getActionName(region)}`,
          lambda: this.lambdas['initialize_organizational_units'],
          userParameters: {
            'ouName': this.getOuName(region),
            'coreAccounts': coreAccounts,
            'tenantAccounts': tenantAccounts
          },
          runOrder: 1,
        }),
      )
    }
    return actions
  }

  /**
   * Returns a clean environment name (alpha, beta, gamma, prod)
   */
  private getStageName(): string {
    if (this.props.environment.startsWith('alpha')) {
      return 'alpha'
    }
    else {
      return this.props.environment
    }
  }

  /**
   *
   */
  private getEnvironmentActions(stageOutputs: { [name: string]: codepipeline.Artifact; }): codepipeline.IAction[] {
    var actions: codepipeline.IAction[] = []
    var runOrder: { count: number } = { count: 1 }
    this.addManagementServicesLoggingStage('management-services-logging', actions, runOrder, stageOutputs)
    this.addTransitInitStage('transit-init', actions, runOrder, stageOutputs)
    this.addManagementServicesInitStage('management-services-init', actions, runOrder, stageOutputs)
    this.addTransitGatewayRouteTablesStage('transit-gateway-routes', actions, runOrder, stageOutputs)
    return actions
  }

  /**
   *
   * @param stageOutputs
   */
  private addManagementServicesLoggingStage(
    stageName: string,
    actions: codepipeline.IAction[],
    runOrder: { count: number },
    stageOutputs: { [name: string]: codepipeline.Artifact; }) {

    const getLoggingInfoAction = new codepipeline_actions.LambdaInvokeAction({
      actionName: 'GetLoggingInfo',
      lambda: this.lambdas[cfw.GET_SSM_PARAMETERS],
      userParameters: {
        'Items': [
          {
            'Name': '/compliant/framework/consolidated-logs/cmk/arn',
            'OutputVariable': 'consolidatedLogsS3BucketCmkArn'
          }
        ]
      },
      runOrder: runOrder.count++,
    });
    actions.push(getLoggingInfoAction)

    var numActions: number[] = []
    for (var region in this.props.config.managementServices) {
      var output = new codepipeline.Artifact();
      stageOutputs[`${stageName}-${region}`] = output

      numActions.push(this.addCloudformationCreateUpdateStackAction(
        actions,
        region,
        {
          actionName: 'ManagementServicesLogging',
          stackName: `management-services-logging`,
          templatePath: this.sources[cfw.MANAGEMENT_SERVICES_CORE].output.atPath(
            'templates/management-services-logging.yml'),
          templatePrefix: this.sources[cfw.MANAGEMENT_SERVICES_CORE].repo.repositoryName,
          bucketRegionalDomainName: this.s3Bucket.bucketRegionalDomainName,
          parameterOverrides: {
            ['pSolutionInfoVersion']: this.props.solutionInfo.version,
            ['pS3Bucket']: this.s3Bucket.bucketName,
            ['pS3Region']: cfw.getS3Region(this.region),
            ['pRepo']: this.sources[cfw.MANAGEMENT_SERVICES_CORE].repo.repositoryName,
            ['pPrimaryRegion']: this.props.config.core.primaryRegion,
            ['pPrincipalOrgId']: this.props.config.central.organizationId,
            ['pLoggingAccountId']: this.props.config.logging.accountId,
            ['pConsolidatedLogsS3BucketCmkArn']: getLoggingInfoAction.variable('consolidatedLogsS3BucketCmkArn')
          },
          capabilities: CfnCapabilities.NAMED_IAM,
          account: this.props.config.managementServices[region].environments[this.props.environment].accountId,
          output,
          outputFileName: `${stageName}-${region}.output`,
        },
        runOrder.count,
        true
      ));
    }
    runOrder.count += Math.max(...numActions)
  }

  /**
   *
   * @param stageOutputs
   */
  private addTransitInitStage(
    stageName: string,
    actions: codepipeline.IAction[],
    runOrder: { count: number },
    stageOutputs: { [name: string]: codepipeline.Artifact; }) {


    var numActions: number[] = []
    for (var region in this.props.config.transit) {
      var output = new codepipeline.Artifact();
      stageOutputs[`${stageName}-${region}`] = output

      numActions.push(this.addCloudformationCreateUpdateStackAction(
        actions,
        region,
        {
          actionName: 'TransitInit',
          stackName: stageName,
          templatePath: this.sources[cfw.TRANSIT_CORE].output.atPath(
            'templates/transit-init.yml'),
          templatePrefix: this.sources[cfw.TRANSIT_CORE].repo.repositoryName,
          bucketRegionalDomainName: this.s3Bucket.bucketRegionalDomainName,
          parameterOverrides: {
            ['pSolutionInfoVersion']: this.props.solutionInfo.version,
            ['pS3Bucket']: this.s3Bucket.bucketName,
            ['pS3Region']: cfw.getS3Region(this.region),
            ['pRepo']: this.sources[cfw.TRANSIT_CORE].repo.repositoryName,
            ['pManagementServicesAccountId']: this.props.config.managementServices[region].environments[this.props.environment].accountId,
            ['pCentralAccountId']: this.props.config.central.accountId,
            ['pPrincipalOrgId']: this.props.config.central.organizationId,
            ['pEnableDirectoryVpc']: this.props.config.managementServices[region].enableDirectoryVpc.toString(),
            ['pEnableExternalAccessVpc']: this.props.config.managementServices[region].enableExternalAccessVpc.toString(),
            ['pEnableVpcFirewall']: this.props.config.transit[region].enableVpcFirewall.toString(),
            ['pEnableVirtualFirewall']: this.props.config.transit[region].enableVirtualFirewall.toString()
          },
          capabilities: CfnCapabilities.ANONYMOUS_IAM,
          account: this.props.config.transit[region].environments[this.props.environment].accountId,
          output,
          outputFileName: `${stageName}-${region}.output`,
        },
        runOrder.count,
        true
      ));
    }
    runOrder.count += Math.max(...numActions)
  }

  /**
   *
   * @param stageOutputs
   */
  private addManagementServicesInitStage(
    stageName: string,
    actions: codepipeline.IAction[],
    runOrder: { count: number },
    stageOutputs: { [name: string]: codepipeline.Artifact; }) {

    var numActions: number[] = []
    for (var region in this.props.config.managementServices) {
      var output = new codepipeline.Artifact();
      stageOutputs[`${stageName}-${region}`] = output

      var transitGatewayId = this.getStageOutput(
        'oTransitGatewayId',
        region,
        stageOutputs[`transit-init-${region}`],
        `transit-init-${region}.output`,
        actions,
        'TransitInit'
      )

      numActions.push(this.addCloudformationCreateUpdateStackAction(
        actions,
        region,
        {
          actionName: 'ManagementServicesInit',
          stackName: stageName,
          templatePath: this.sources[cfw.MANAGEMENT_SERVICES_CORE].output.atPath(
            'templates/management-services-init.yml'),
          templatePrefix: this.sources[cfw.MANAGEMENT_SERVICES_CORE].repo.repositoryName,
          bucketRegionalDomainName: this.s3Bucket.bucketRegionalDomainName,
          parameterOverrides: {
            ['pSolutionInfoVersion']: this.props.solutionInfo.version,
            ['pS3Bucket']: this.s3Bucket.bucketName,
            ['pS3Region']: cfw.getS3Region(this.region),
            ['pRepo']: this.sources[cfw.MANAGEMENT_SERVICES_CORE].repo.repositoryName,
            ['pEnableDirectoryVpc']: this.props.config.managementServices[region].enableDirectoryVpc.toString(),
            ['pEnableExternalAccessVpc']: this.props.config.managementServices[region].enableExternalAccessVpc.toString(),
            ['pTransitGatewayId']: transitGatewayId,
            ['pPrincipalOrgId']: this.props.config.central.organizationId,
          },
          capabilities: CfnCapabilities.ANONYMOUS_IAM,
          extraInputs: [stageOutputs[`transit-init-${region}`]],
          account: this.props.config.managementServices[region].environments[this.props.environment].accountId,
          output,
          outputFileName: `${stageName}-${region}.output`,
        },
        runOrder.count,
        true
      ));
    }
    runOrder.count += Math.max(...numActions)
  }

  /**
   *
   * @param stageOutputs
   */
  private addTransitGatewayRouteTablesStage(
    stageName: string,
    actions: codepipeline.IAction[],
    runOrder: { count: number },
    stageOutputs: { [name: string]: codepipeline.Artifact; }) {

    var numActions: number[] = []
    for (var region of this.props.config.deployToRegions) {

      // Only configure these stacksets if region is enabled
      // for management services and transit
      if (region in this.props.config.transit &&
        region in this.props.config.managementServices) {
        var output = new codepipeline.Artifact();
        stageOutputs[`${stageName}-${region}`] = output

        // Build the parameters
        let params: { [name: string]: any; } = {}

        // Base Params
        params['pSolutionInfoVersion'] = this.props.solutionInfo.version
        params['pS3Bucket'] = this.s3Bucket.bucketName
        params['pS3Region'] = cfw.getS3Region(this.region)
        params['pRepo'] = this.sources[cfw.TRANSIT_CORE].repo.repositoryName

        // Management Services VPC
        params['pManagementServicesVpcTgwAttachId'] =
          this.getStageOutput(
            'oManagementServicesVpcTransitGatewayAttachmentId',
            region,
            stageOutputs[`management-services-init-${region}`],
            `management-services-init-${region}.output`,
            actions,
            'ManagementServicesInit'
          )

        // Directory VPC (if enabled)
        if (this.props.config.managementServices[region].enableDirectoryVpc) {
          params['pDirectoryVpcTgwAttachId'] =
            this.getStageOutput(
              'oDirectoryVpcTransitGatewayAttachmentId',
              region,
              stageOutputs[`management-services-init-${region}`],
              `management-services-init-${region}.output`,
              actions,
              'ManagementServicesInit'
            )
        }

        // External Access VPC (if enabled)
        if (this.props.config.managementServices[region].enableExternalAccessVpc) {
          params['pExternalAccessVpcTgwAttachId'] =
            this.getStageOutput(
              'oExternalAccessVpcTransitGatewayAttachmentId',
              region,
              stageOutputs[`management-services-init-${region}`],
              `management-services-init-${region}.output`,
              actions,
              'ManagementServicesInit'
            )
        }

        // Create the action
        numActions.push(this.addCloudformationCreateUpdateStackAction(
          actions,
          region,
          {
            actionName: 'TransitGatewayRouteTables',
            stackName: stageName,
            templatePath: this.sources[cfw.TRANSIT_CORE].output.atPath(
              'templates/transit-gateway-route-tables.yml'),
            templatePrefix: this.sources[cfw.TRANSIT_CORE].repo.repositoryName,
            bucketRegionalDomainName: this.s3Bucket.bucketRegionalDomainName,
            parameterOverrides: params,
            extraInputs: [
              stageOutputs[`transit-init-${region}`],
              stageOutputs[`management-services-init-${region}`]
            ],
            account: this.props.config.transit[region].environments[this.props.environment].accountId,
            output,
            outputFileName: `${stageName}-${region}.output`,
          },
          runOrder.count,
          true
        ));
      }
    }
    runOrder.count += Math.max(...numActions)
  }

  private getOuName(region: string): string {
    let ouName = `environment-${cfw.getActionName(region).toLowerCase()}-${this.props.environment}`;
    if (this.props.environment === 'default') {
      ouName = `environment-${cfw.getActionName(region).toLowerCase()}`
    }
    return ouName;
  }

  /**
   *
   */
  private getSecurityBaselineActions(): codepipeline.IAction[] {

    let tags: any = [
      {
        Key: 'solution-info:built-by',
        Value: this.props.solutionInfo.builtBy
      },
      {
        Key: 'solution-info:name',
        Value: this.props.solutionInfo.name
      },
      {
        Key: 'solution-info:version',
        Value: this.props.solutionInfo.version
      }
    ]

    let actions: codepipeline.IAction[] = []


    for (var region of this.props.config.deployToRegions) {
      var security_baseline_stackset_name = `security-baseline-stackset-${region}`
      var backup_services_stackset_name = `backup-services-stackset-${region}`
      if (this.props.environment === 'default') {
        security_baseline_stackset_name = `${this.props.environment}-security-baseline-stackset-${region}`
        backup_services_stackset_name = `${this.props.environment}-backup-services-stackset-${region}`
      }

      // Only configure these stacksets if region is enabled
      // for management services
      if (region in this.props.config.managementServices) {
        actions.push(
          new codepipeline_actions.LambdaInvokeAction({
            actionName: `SecurityBase-StackSet-${cfw.getActionName(region)}`,
            lambda: this.lambdas[cfw.STACK_SET_ACTION],
            userParameters: {
              'stackSetName': security_baseline_stackset_name,
              'ouName': this.getOuName(region),
              'templateUrl': `https://${this.s3Bucket.bucketRegionalDomainName}/` +
                `${this.sources[cfw.SECURITY_BASELINE].repo.repositoryName}/` +
                `templates/security-baseline.yml`,
              'region': region,
              'ssmParameterPath':
                '/compliant/framework/central/stack-set/parameters/security-baseline',
              'parameters': {
                'pCentralAccountId': this.props.config.central.accountId,
                'pManagementServicesAccountId': this.props.config.managementServices[region]
                  .environments[this.props.environment].accountId,
                //'pComplianceSet': this.props.config.complianceSet
              },
              'capabilities': [
                'CAPABILITY_NAMED_IAM'
              ],
              'tags': tags
            },
            runOrder: 1,
          }),
        )

        // Create account list for SecurityHub invites
        var environmentAccounts = [
          this.props.config.transit[region].environments[this.props.environment].accountId,
          this.props.config.managementServices[region].environments[this.props.environment].accountId
        ]
        for (var plugin in this.props.config.plugins) {
          for (var action of this.props.config.plugins[plugin][region].actions) {
            var accountId = action.environments[this.props.environment].accountId
            if (!environmentAccounts.includes(accountId)) {
              environmentAccounts.push(accountId)
            }
          }
        }

        actions.push(
          new codepipeline_actions.LambdaInvokeAction({
            actionName: `SecurityHub-InviteMembers-${cfw.getActionName(region)}`,
            lambda: this.lambdas[cfw.SECURITY_HUB_INVITE_MEMBERS],
            userParameters: {
              'accountIds': environmentAccounts,
              'partition': this.partition,
              'region': region
            },
            runOrder: 2,
          })
        );

        actions.push(
          new codepipeline_actions.LambdaInvokeAction({
            actionName: `BackupServices-StackSet-${cfw.getActionName(region)}`,
            lambda: this.lambdas[cfw.STACK_SET_ACTION],
            userParameters: {
              'stackSetName': backup_services_stackset_name,
              'ouName': this.getOuName(region),
              'templateUrl': `https://${this.s3Bucket.bucketRegionalDomainName}/` +
                `${this.sources[cfw.SECURITY_BASELINE].repo.repositoryName}/` +
                `templates/backup-services.yml`,
              'region': region,
              'parameters': {
              },
              'capabilities': [
                'CAPABILITY_NAMED_IAM'
              ],
              'tags': tags
            },
            runOrder: 1,
          }),
        );

      }

    }

    return actions
  }

  /**
   *
   * @param item
   * @param stageOutputs
   */
  private getPluginActions(
    item: string,
    stageOutputs: {
      [name: string]: codepipeline.Artifact;
    },
    environmentActions: codepipeline.IAction[]): codepipeline.IAction[] {
    var actions: codepipeline.IAction[] = []

    for (var region in this.props.config.plugins[item]) {
      for (var action of this.props.config.plugins[item][region].actions) {

        var deploymentAction = action.deploymentAction
        if (deploymentAction == 'cloudformation') {
          var name = 'plugin-' + item
          var output = new codepipeline.Artifact()

          var transitGatewayId = this.getStageOutput('oTransitGatewayId', region,
            stageOutputs[`transit-init-${region}`], `transit-init-${region}.output`,
            environmentActions, 'TransitInit'
          )

          this.addCloudformationCreateUpdateStackAction(
            actions,
            region,
            {
              actionName: action.actionName,
              stackName: `plugin-${action.actionName}`,
              templatePath: this.sources[name].output.atPath(action.templatePath),
              templatePrefix: this.sources[name].repo.repositoryName,
              bucketRegionalDomainName: this.s3Bucket.bucketRegionalDomainName,
              parameterOverrides: {
                ['pSolutionInfoVersion']: this.props.solutionInfo.version,
                ['pS3Bucket']: this.s3Bucket.bucketName,
                ['pS3Region']: cfw.getS3Region(this.region),
                ['pRepo']: this.sources[cfw.MANAGEMENT_SERVICES_CORE].repo.repositoryName,
                // ['pName']: this.props.program,
                ['pEnvironment']: this.getStageName(),
                ['pManagementServicesAccountId']: this.props.config.managementServices[region].environments[this.props.environment].accountId,
                ['pCentralAccountId']: this.props.config.central.accountId,
                ['pTransitGatewayId']: transitGatewayId,
                ['pPrincipalOrgId']: this.props.config.central.organizationId,
              },
              capabilities: CfnCapabilities.ANONYMOUS_IAM,
              extraInputs: [stageOutputs[`transit-init-${region}`]],
              account: action.environments[this.props.environment].accountId,
              output,
              outputFileName: `${name}-${region}.output`,
            },
            1,
            true
          );

          if (action.hasTransitGatewayAttachment) {

            var tgwAttachId = this.getStageOutput(
              'oTransitGatewayAttachmentId', region, output, `${name}-${region}.output`, actions, action.actionName,
            )

            var directoryRtId = 'xxxxxx'
            if (this.props.config.managementServices[region].enableDirectoryVpc) {
              directoryRtId = this.getStageOutput('oTransitGatewayDirectoryRouteTableId',
                region, stageOutputs[`transit-init-${region}`], `transit-init-${region}.output`,
                environmentActions, 'TransitInit')
            }

            var firewallRtId = 'xxxxxx'
            if (this.props.config.managementServices[region].enableVirtualFirewall) {
              firewallRtId = this.getStageOutput('oTransitGatewayFirewallRouteTableId',
                region, stageOutputs[`transit-init-${region}`], `transit-init-${region}.output`,
                environmentActions, 'TransitInit')
            }

            var inspectionRtId = 'xxxxxx'
            if (this.props.config.managementServices[region].enableVpcFirewall) {
              inspectionRtId = this.getStageOutput('oTransitGatewayInspectionRouteTableId',
                region, stageOutputs[`transit-init-${region}`], `transit-init-${region}.output`,
                environmentActions, 'TransitInit')
            }

            var externalAccessRtId = 'xxxxxx'
            if (this.props.config.managementServices[region].enableExternalAccessVpc) {
              externalAccessRtId = this.getStageOutput('oTransitGatewayExternalAccessRouteTableId',
                region, stageOutputs[`transit-init-${region}`], `transit-init-${region}.output`,
                environmentActions, 'TransitInit')
            }

            this.addCloudformationCreateUpdateStackAction(
              actions,
              region,
              {
                actionName: `${action.actionName}-tgw-attachment`,
                stackName: `plugin-${action.actionName}-tgw-attachment`,
                templatePath: this.sources[cfw.TRANSIT_CORE].output.atPath('templates/transit-attach-tenant.yml'),
                templatePrefix: this.sources[cfw.TRANSIT_CORE].repo.repositoryName,
                bucketRegionalDomainName: this.s3Bucket.bucketRegionalDomainName,
                parameterOverrides: {
                  ['pTgwAttachId']: tgwAttachId,
                  ['pDirectoryRtId']: directoryRtId,
                  ['pFirewallRtId']: firewallRtId,
                  ['pInspectionRtId']: inspectionRtId,
                  ['pExternalAccessRtId']: externalAccessRtId,
                },
                extraInputs: [output, stageOutputs[`transit-init-${region}`]],
                account: action.environments[this.props.environment].accountId,
                output,
                outputFileName: `${name}-${region}.output`,
              },
              3,
              true
            );
          }
        }
        else if (deploymentAction == 'cdk') {
          //do CDK actions
        }
        //   }

      }
    }
    return actions
  }

  /**
   *
   */
  private getFederationSupportActions(): codepipeline.IAction[] {

    let tags: any = [
      {
        Key: 'solution-info:built-by',
        Value: this.props.solutionInfo.builtBy
      },
      {
        Key: 'solution-info:name',
        Value: this.props.solutionInfo.name
      },
      {
        Key: 'solution-info:version',
        Value: this.props.solutionInfo.version
      }
    ]

    let actions: codepipeline.IAction[] = []

    for (var region of this.props.config.deployToRegions) {
      actions.push(
        new codepipeline_actions.LambdaInvokeAction({
          actionName: `Federation-StackSet-${cfw.getActionName(region)}`,
          lambda: this.lambdas[cfw.STACK_SET_ACTION],
          userParameters: {
            'stackSetName': `${this.props.environment}-federation-stackset-${region}`,
            'ouName': this.getOuName(region),
            'templateUrl': `https://${this.s3Bucket.bucketRegionalDomainName}/` +
              `${this.sources[cfw.SECURITY_BASELINE].repo.repositoryName}/` +
              'templates/federation/federation.yml',
            'region': region,
            'parameters': {
              'pFederationName': this.props.config.federation.name
            },
            'capabilities': [
              'CAPABILITY_NAMED_IAM'
            ],
            'tags': tags
          },
          runOrder: 1,
        }),
      );
    }

    if (this.props.environment == this.props.config.federation.sourceEnvironment) {
      actions.push(new codepipeline_actions.CloudFormationCreateUpdateStackAction({
        actionName: 'Federation-CentralAccount',
        stackName: 'federation-stack',
        adminPermissions: true,
        replaceOnFailure: true,
        templatePath: this.sources[cfw.SECURITY_BASELINE].output.atPath('templates/federation/federation.yml'),
        parameterOverrides: {
          ['pFederationName']: this.props.config.federation.name,

        },
        runOrder: 2
      }));

      actions.push(new codepipeline_actions.CloudFormationCreateUpdateStackAction({
        actionName: 'Federation-LoggingAccount',
        stackName: 'federation-stack',
        adminPermissions: true,
        replaceOnFailure: true,
        templatePath: this.sources[cfw.SECURITY_BASELINE].output.atPath('templates/federation/federation.yml'),
        parameterOverrides: {
          ['pFederationName']: this.props.config.federation.name,

        },
        account: this.props.config.logging.accountId,
        runOrder: 2
      }));
    }

    return actions
  }

  /**
   *
   */
  private updateGrants() {
    this.s3Bucket.grantReadWrite(
      new iam.OrganizationPrincipal(this.props.config.central.organizationId)
    );

    this.s3Bucket.grantReadWrite(
      this.lambdas[cfw.COPY_CODECOMMIT_REPOSITORIES_TO_S3]
    );
    this.s3Bucket.grantReadWrite(
      this.lambdas[cfw.UPDATE_ARTIFACT_ACL]
    )

    for (var source in this.sources) {
      this.sources[source].repo.grantRead(
        this.lambdas[cfw.COPY_CODECOMMIT_REPOSITORIES_TO_S3]
      );
    }

    this.lambdas['initialize_organizational_units'].addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'organizations:CreateOrganizationalUnit',
          'organizations:DescribeOrganizationalUnit',
          'organizations:ListChildren',
          'organizations:ListRoots',
          'organizations:MoveAccount'
        ],
        resources: [
          '*'
        ]
      })
    );

    this.lambdas[cfw.STACK_SET_ACTION].addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'organizations:DescribeOrganizationalUnit',
          'organizations:ListChildren',
          'organizations:ListRoots',
          'cloudformation:CreateStackInstances',
          'cloudformation:CreateStackSet',
          'cloudformation:DescribeStackSet',
          'cloudformation:DescribeStackSetOperation',
          'cloudformation:TagResource',
          'cloudformation:UpdateStackSet',
          'ssm:getParameter'
        ],
        resources: [
          '*'
        ]
      })
    );

    this.lambdas[cfw.SECURITY_HUB_INVITE_MEMBERS].addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'securityhub:AcceptInvitation',
          'securityhub:CreateMembers',
          'securityhub:InviteMembers',
          'securityhub:ListMembers',
          'sts:AssumeRole'
        ],
        resources: [
          '*'
        ]
      })
    );

    this.lambdas[cfw.GET_SSM_PARAMETERS].addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ssm:GetParameter'
        ],
        resources: [
          '*'
        ]
      })
    );

    this.lambdas[cfw.CREATE_UPDATE_STACK].addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          '*',
        ],
        resources: [
          '*'
        ]
      })
    );
  }


}
