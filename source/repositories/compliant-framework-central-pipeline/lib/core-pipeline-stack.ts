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

export class CorePipelineStack extends cfw.PipelineStackBase {

  constructor(scope: cdk.Construct, id: string, props: cfw.PipelineStackProps) {
    super(scope, id, props);

    this.initializeRepos();
    this.createPipeline();
    this.updateGrants();
  }

  /**
   * Initializes the source objects for the core pipeline.
   */
  private initializeRepos() {
    this.sources = {} // Initialize list

    let repoName = cfw.CENTRAL_CORE
    let resourceId = 'rCentralCoreRepo'
    this.sources[repoName] = {
      repo: codecommit.Repository.fromRepositoryName(this, resourceId,
        'compliant-framework-central-core'),
      output: new codepipeline.Artifact()
    }
  }

  private createPipeline() {
    const pipeline = new codepipeline.Pipeline(this, 'rPipeline', {
      pipelineName: `compliant-framework-${this.props.pipelineName}`,
      artifactBucket: this.s3Bucket
    });

    this.lambdas[cfw.COPY_CODECOMMIT_REPOSITORIES_TO_S3].grantInvoke(pipeline.role)

    pipeline.addStage({
      stageName: 'Source',
      actions: this.getSourceActions()
    });

    pipeline.addStage({
      stageName: 'Deploy-CopySourceToS3',
      actions: this.getCopySourceToS3Actions()
    });

    pipeline.addStage({
      stageName: 'Deploy-InitializeCoreAccounts',
      actions: this.getInitializeCoreAccountsActions()
    });

    pipeline.addStage({
      stageName: 'SecurityHub-InviteMembers',
      actions: this.getSecurityHubActions()
    });
  }

  private getSourceActions(): codepipeline.IAction[] {
    var actions = [
      new codepipeline_actions.CodeCommitSourceAction({
        actionName: 'central-core',
        repository: this.sources[cfw.CENTRAL_CORE].repo,
        branch: this.props.pipelineName,
        output: this.sources[cfw.CENTRAL_CORE].output
      })
    ]
    return actions
  }

  private getCopySourceToS3Actions(): codepipeline.IAction[] {
    var actions = [
      new codepipeline_actions.LambdaInvokeAction({
        actionName: 'Central',
        lambda: this.lambdas[cfw.COPY_CODECOMMIT_REPOSITORIES_TO_S3],
        userParameters: {
          'bucketName': this.s3Bucket.bucketName,
          'kmsKeyId': this.s3BucketCmkAlias.keyId,
          'repositoryNames': [
            this.sources[cfw.CENTRAL_CORE].repo.repositoryName,
          ],
          'branchName': this.props.pipelineName
        },
        inputs: [
          this.sources[cfw.CENTRAL_CORE].output,
        ],
        runOrder: 1,
      }),
    ]
    return actions
  }

  private getInitializeCoreAccountsActions(): codepipeline.IAction[] {
    var actions: codepipeline.IAction[] = []

    var output = new codepipeline.Artifact()

    var runOrder = 1

    for (const region of this.props.config.deployToRegions) {

      runOrder += this.addCloudformationCreateUpdateStackAction(
        actions,
        region,
        {
          actionName: 'LoggingInit',
          stackName: 'logging-init',
          templatePath: this.sources[cfw.CENTRAL_CORE].output.atPath(
            'templates/logging/logging-init.yml'),
          templatePrefix: `${this.sources[cfw.CENTRAL_CORE].repo.repositoryName}`,
          bucketRegionalDomainName: this.s3Bucket.bucketRegionalDomainName,
          parameterOverrides: {
            ['pSolutionInfoVersion']: this.props.solutionInfo.version,
            ['pS3Bucket']: this.s3Bucket.bucketName,
            ['pS3Region']: cfw.getS3Region(this.region),
            ['pRepo']: this.sources[cfw.CENTRAL_CORE].repo.repositoryName,
            ['pCentralAccountId']: this.props.config.central.accountId,
            ['pPrimaryRegion']: this.props.config.core.primaryRegion,
            ['pNotificationsEmail']: this.props.config.core.notificationsEmail,
            ['pPrincipalOrgId']: this.props.config.central.organizationId
          },
          capabilities: CfnCapabilities.NAMED_IAM,
          account: this.props.config.logging.accountId,
          output: output,
          outputFileName: `logging-init-${this.props.config.core.primaryRegion}.output`,
        },
        runOrder,
        true
      );

      runOrder += this.addCloudformationCreateUpdateStackAction(
        actions,
        region,
        {
          actionName: 'CentralInit',
          stackName: 'central-init',
          templatePath: this.sources[cfw.CENTRAL_CORE].output.atPath(
            'templates/central/central-init.yml'),
          templatePrefix: this.sources[cfw.CENTRAL_CORE].repo.repositoryName,
          bucketRegionalDomainName: this.s3Bucket.bucketRegionalDomainName,
          parameterOverrides: {
            ['pSolutionInfoVersion']: this.props.solutionInfo.version,
            ['pS3Bucket']: this.s3Bucket.bucketName,
            ['pS3Region']: cfw.getS3Region(this.region),
            ['pRepo']: this.sources[cfw.CENTRAL_CORE].repo.repositoryName,
            ['pLoggingAccountId']: this.props.config.logging.accountId,
            ['pPrimaryRegion']: this.props.config.core.primaryRegion,
            ['pNotificationsEmail']: this.props.config.core.notificationsEmail,
            ['pConsolidatedLogsS3BucketCmkArn']: output.getParam(`logging-init-${this.props.config.core.primaryRegion}.output`, 'oConsolidatedLogsS3BucketCmkArn')
          },
          capabilities: CfnCapabilities.NAMED_IAM,
          account: this.props.config.central.accountId,
          extraInputs: [output]
        },
        runOrder,
        false
      );
    }

    return (actions)
  }

  private getSecurityHubActions(): codepipeline.IAction[] {
    var actions: codepipeline.IAction[] = []

    for (const region of this.props.config.deployToRegions) {
      actions.push(new codepipeline_actions.LambdaInvokeAction({
        actionName: `InviteMembers-${cfw.getActionName(region)}`,
        lambda: this.lambdas[cfw.SECURITY_HUB_INVITE_MEMBERS],
        userParameters: {
          'accountIds': [
            this.props.config.logging.accountId
          ],
          'partition': this.partition,
          'region': region

        },
        runOrder: 1,
      }),
      )
    }
    return actions
  }


  private updateGrants() {
    this.s3Bucket.grantReadWrite(
      new iam.OrganizationPrincipal(this.props.config.central.organizationId)
    );

    this.s3Bucket.grantReadWrite(
      this.lambdas[cfw.COPY_CODECOMMIT_REPOSITORIES_TO_S3]
    );
    this.s3Bucket.grantReadWrite(
      this.lambdas[cfw.SECURITY_HUB_INVITE_MEMBERS]
    )

    this.sources[cfw.CENTRAL_CORE].repo.grantRead(
      this.lambdas[cfw.COPY_CODECOMMIT_REPOSITORIES_TO_S3]
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
