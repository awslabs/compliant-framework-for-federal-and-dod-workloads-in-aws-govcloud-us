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
import * as kms from '@aws-cdk/aws-kms';
import * as lambda from '@aws-cdk/aws-lambda';
import * as s3 from '@aws-cdk/aws-s3';
import { Tags } from '@aws-cdk/core';

import fs = require('fs')

// Repositories
export const CENTRAL_CORE = 'central-core';
export const TRANSIT_CORE = 'transit-core';
export const MANAGEMENT_SERVICES_CORE = 'management-services-core';
export const SECURITY_BASELINE = 'security-baseline';

// Lambda Functions
export const CREATE_UPDATE_STACK = 'create_update_stack';
export const COPY_CODECOMMIT_REPOSITORIES_TO_S3 = 'copy_codecommit_repositories_to_s3';
export const SECURITY_HUB_INVITE_MEMBERS = 'security_hub_invite_members';
export const UPDATE_ARTIFACT_ACL = 'update_artifact_acl';
export const GET_SSM_PARAMETERS = 'get_ssm_parameters';
export const STACK_SET_ACTION = 'stack_set_action';

// Regions
export const US_GOV_WEST_1 = 'us-gov-west-1'
export const US_GOV_EAST_1 = 'us-gov-east-1'

export interface PipelineStackProps extends cdk.StackProps {
  pipelineName: string,
  environment: string,
  config: any,
  solutionInfo: {
    builtBy: string,
    name: string,
    version: string
  }
}

function isPipelinesSupported(region: string): boolean {
  return (region != US_GOV_EAST_1)
}

export function getActionName(region: string): string {
  var actionName = 'USGW1';
  switch (region) {
    case US_GOV_WEST_1:
      actionName = 'USGW1';
      break;
    case US_GOV_EAST_1:
      actionName = 'USGE1';
      break;
  }
  return actionName;
}

export function getS3Region(region: string): string {
  var s3Region = 's3';
  switch (region) {
    case US_GOV_WEST_1:
      s3Region = 's3-us-gov-west-1';
      break;
    case US_GOV_EAST_1:
      s3Region = 's3-us-gov-east-1';
      break;
  }
  return s3Region;

}


export abstract class PipelineStackBase extends cdk.Stack {

  /**
   * Input parameters and properties for the stack.
   */
  protected props: PipelineStackProps

  /**
   * List of all lambdas in use by the pipeline.
   *
   * All packages present in the ./lambda directory will be added as python
   * packages into the central account for use within the pipeline.
   */
  protected lambdas: {
    [name: string]: lambda.Function
  }

  /**
   * List of all codecommit repos in use by the pipeline.
   */
  protected sources: {
    [name: string]: {
      repo: codecommit.IRepository
      output: codepipeline.Artifact
    };
  } = {}

  protected s3BucketCmkAlias: kms.Alias
  protected s3Bucket: s3.Bucket

  constructor(scope: cdk.Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    Tags.of(this).add('solution-info:built-by', props.solutionInfo.builtBy)
    Tags.of(this).add('solution-info:name', props.solutionInfo.name)
    Tags.of(this).add('solution-info:version', props.solutionInfo.version)

    this.props = props

    // Initialize member lists
    this.lambdas = {}
    this.sources = {}

    // Common
    this.createCmks();
    this.createArtifactBuckets();
    this.createLambdas();
  }

  /**
   * Creates the CMKs needed for the pipeline.
   *
   */
  private createCmks(): void {
    const s3BucketCmk = new kms.Key(this, 'rS3BucketCmk', {
      enableKeyRotation: true,
      description: `${this.props.pipelineName} S3 CMK`,
    })
    this.s3BucketCmkAlias = new kms.Alias(this, 'rS3BucketCmkAlias', {
      aliasName: `alias/compliant-framework/${this.props.pipelineName}-pipeline/s3`,
      targetKey: s3BucketCmk
    })
  }

  /**
   * Creates the S3 bucket needed for the pipeline.
   *
   */
  private createArtifactBuckets(): void {
    this.s3Bucket = new s3.Bucket(this, 'rS3Bucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.s3BucketCmkAlias,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      bucketName: `${this.props.pipelineName}-${this.account}-${this.region}`,
      versioned: true
    })
    this.s3Bucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'deny-non-encrypted-object-uploads',
      effect: iam.Effect.DENY,
      actions: [
        's3:PutObject'
      ],
      resources: [
        this.s3Bucket.arnForObjects('*')
      ],
      principals: [
        new iam.AnyPrincipal()
      ],
      conditions: {
        'StringNotEquals': {
          's3:x-amz-server-side-encryption': 'aws:kms'
        }
      }
    }))
    this.s3Bucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'deny-insecure-connections',
      effect: iam.Effect.DENY,
      actions: [
        's3:*'
      ],
      resources: [
        this.s3Bucket.arnForObjects('*')
      ],
      principals: [
        new iam.AnyPrincipal()
      ],
      conditions: {
        'Bool': {
          'aws:SecureTransport': 'false'
        }
      }
    }))
  }

  /**
   * Initializes the lambdas list used by the pipeline.
   *
   * All lambda packages found in the lambda folder will be created as
   * lambda functions. A reference to the function will be stored into
   * the lambdas list and can be accessed using the name of the lambda
   * package.
   */
  private createLambdas(): void {
    fs.readdirSync('lambda/').forEach(file => {
      this.lambdas[file] =
        new lambda.Function(this, file.replace(/-/gi, ''), {
          functionName: `${this.props.pipelineName}-${file}`,
          code: new lambda.AssetCode(`lambda/${file}`),
          handler: 'index.lambda_handler',
          timeout: cdk.Duration.seconds(300),
          runtime: lambda.Runtime.PYTHON_3_8,
        });
    });
  }

  protected getStageOutput(
    variable: string,
    region: string,
    output?: codepipeline.Artifact,
    outputFileName?: string,
    actions?: codepipeline.IAction[],
    actionName?: string
  ): any {

    if (isPipelinesSupported(region)) {
      if (output && outputFileName) {
        return output.getParam(outputFileName, variable)
      }
    }

    else if (actions && actionName) {
      for (var action of actions) {
        if (action.actionProperties.actionName ===
          `${actionName}-${getActionName(region)}`) {
          var lambdaAction = action as codepipeline_actions.LambdaInvokeAction;
          return lambdaAction.variable(variable)
        }
      }
    }

    throw new Error()

  }

  protected addCloudformationCreateUpdateStackAction(
    actions: codepipeline.IAction[],
    region: string,
    props: {
      actionName: string,
      stackName: string,
      templatePath: codepipeline.ArtifactPath,
      templatePrefix: string,
      bucketRegionalDomainName: string,
      parameterOverrides?: { [name: string]: any },
      capabilities?: string,
      account: string,
      output?: codepipeline.Artifact,
      outputFileName?: string
      extraInputs?: codepipeline.Artifact[],
    },
    runOrder: number,
    updateAcl: boolean,
  ): number {

    var numActions = 0;

    if (isPipelinesSupported(region)) {
      if (props.output && props.outputFileName) {
        actions.push(new codepipeline_actions.CloudFormationCreateUpdateStackAction({
          actionName: `${props.actionName}-${getActionName(region)}`,
          stackName: props.stackName,
          adminPermissions: true,
          replaceOnFailure: true,
          templatePath: props.templatePath,
          parameterOverrides: props.parameterOverrides,
          account: props.account,
          output: props.output,
          outputFileName: props.outputFileName,
          extraInputs: props.extraInputs,
          runOrder: (runOrder + numActions++),
          region: region
        }));
      }
      else {
        actions.push(new codepipeline_actions.CloudFormationCreateUpdateStackAction({
          actionName: `${props.actionName}-${getActionName(region)}`,
          stackName: props.stackName,
          adminPermissions: true,
          replaceOnFailure: true,
          templatePath: props.templatePath,
          parameterOverrides: props.parameterOverrides,
          account: props.account,
          extraInputs: props.extraInputs,
          runOrder: (runOrder + numActions++),
          region: region
        }));
      }

      if (updateAcl) {
        actions.push(new codepipeline_actions.LambdaInvokeAction({
          actionName: `${props.actionName}UpdateAcl-${getActionName(region)}`,
          lambda: this.lambdas[UPDATE_ARTIFACT_ACL],
          userParameters: {
            'bucketName': this.s3Bucket.bucketName,
            'kmsKeyId': this.s3BucketCmkAlias.keyId,
          },
          inputs: (props.output) ? [props.output] : [],
          runOrder: (runOrder + numActions++),
        }));
      }

    }
    else {
      // For unsupported regions we use a lambda in the Primary Account to
      // deploy the stack into the target region
      actions.push(new codepipeline_actions.LambdaInvokeAction({
        actionName: `${props.actionName}-${getActionName(region)}`,
        lambda: this.lambdas[CREATE_UPDATE_STACK],
        userParameters: {
          'stackName': props.stackName,
          'templatePath': props.templatePath.fileName,
          'templatePrefix': props.templatePrefix,
          'bucketRegionalDomainName': props.bucketRegionalDomainName,
          'parameterOverrides': props.parameterOverrides,
          'capabilities': props.capabilities,
          'account': props.account,
          'region': region
        },
        runOrder: (runOrder + numActions++),
      }));
    }

    return numActions;
  }

}
