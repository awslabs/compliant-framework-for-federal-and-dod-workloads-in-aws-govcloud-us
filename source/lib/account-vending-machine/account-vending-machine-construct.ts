/*********************************************************************************************************************
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
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import * as servicecatalog from '@aws-cdk/aws-servicecatalog';

export class AccountVendingMachine extends cdk.Construct {

  constructor(scope: cdk.Construct, id: string) {
    super(scope, id);

    this.addCreateGovCloudAccountFunction()
    this.addInviteGovCloudAccountFunction()
    this.addGetOuFunction()
    this.addMoveAccountFunction()
    this.addServiceCatalog()
  }

  private getSsmPolicy() {
    return new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ssm:GetParameter"
      ],
      resources: [
        cdk.Stack.of(this).formatArn({
          service: 'ssm',
          resource: 'parameter',
          sep: '/',
          resourceName: 'compliant/framework/central-avm/aws-us-gov/access-key-id'
        }),
        cdk.Stack.of(this).formatArn({
          service: 'ssm',
          resource: 'parameter',
          sep: '/',
          resourceName: 'compliant/framework/central-avm/aws-us-gov/secret-access-key'
        })
      ]
    });
  }

  private getLambdaPolicy(functionName: string) {
    return new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents'
      ],
      resources: [
        cdk.Stack.of(this).formatArn({
          service: 'logs',
          resource: 'log-group',
          sep: ':',
          resourceName: functionName
        })
      ]
    });
  }

  private suppressWarnings(lambdaFunction: lambda.Function) {
    const cfnLambdaFunction = lambdaFunction.node.findChild('Resource') as lambda.CfnFunction;
    cfnLambdaFunction.cfnOptions.metadata = {
      cfn_nag: {
        rules_to_suppress: [{
          id: 'W58',
          reason: `Lambda functions has the required permission to write CloudWatch Logs. It uses custom policy instead of arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole with more tighter permissions.`
        }]
      }
    };
  }

  private addCreateGovCloudAccountFunction() {
    let functionName = 'CompliantFramework-AvmCreateGovCloudAccount'
    const lambdaFunction =
      new lambda.Function(this, 'AvmCreateGovCloudAccountFunction', {
        functionName,
        code: new lambda.AssetCode('lambda/avm_create_govcloud_account'),
        handler: 'index.lambda_handler',
        timeout: cdk.Duration.seconds(900),
        runtime: lambda.Runtime.PYTHON_3_8,
        initialPolicy: [
          this.getLambdaPolicy(functionName),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "organizations:CreateGovCloudAccount",
              "organizations:ListAccounts",
              "organizations:DescribeCreateAccountStatus"
            ],
            resources: ["*"]
          })
        ]
      });
    this.suppressWarnings(lambdaFunction)

    const cfnLambdaFunctionDefPolicy = lambdaFunction.role?.node.tryFindChild('DefaultPolicy')?.node.findChild('Resource') as iam.CfnPolicy;
    cfnLambdaFunctionDefPolicy.cfnOptions.metadata = {
      cfn_nag: {
        rules_to_suppress: [{
          id: 'W12',
          reason: `Lambda permission actions require use of * resource`
        }]
      }
    };

  };

  private addInviteGovCloudAccountFunction() {
    let functionName = 'CompliantFramework-AvmInviteGovCloudAccount'
    const lambdaFunction =
      new lambda.Function(this, 'AvmInviteGovCloudAccountFunction', {
        functionName,
        code: new lambda.AssetCode('lambda/avm_invite_govcloud_account'),
        handler: 'index.lambda_handler',
        timeout: cdk.Duration.seconds(900),
        runtime: lambda.Runtime.PYTHON_3_8,
        initialPolicy: [
          this.getLambdaPolicy(functionName),
          this.getSsmPolicy()
        ]
      });
    this.suppressWarnings(lambdaFunction)
  };

  private addGetOuFunction() {
    let functionName = 'CompliantFramework-AvmGetOu'
    const lambdaFunction =
      new lambda.Function(this, 'AvmGetOuFunction', {
        functionName,
        code: new lambda.AssetCode('lambda/avm_get_ou'),
        handler: 'index.lambda_handler',
        timeout: cdk.Duration.seconds(900),
        runtime: lambda.Runtime.PYTHON_3_8,
        initialPolicy: [
          this.getLambdaPolicy(functionName),
          this.getSsmPolicy()
        ]
      });
    this.suppressWarnings(lambdaFunction)
  };

  private addMoveAccountFunction() {
    let functionName = 'CompliantFramework-AvmMoveAccount'
    const lambdaFunction =
      new lambda.Function(this, 'AvmMoveAccountFunction', {
        functionName,
        code: new lambda.AssetCode('lambda/avm_move_account'),
        handler: 'index.lambda_handler',
        timeout: cdk.Duration.seconds(900),
        runtime: lambda.Runtime.PYTHON_3_8,
        initialPolicy: [
          this.getLambdaPolicy(functionName),
          this.getSsmPolicy()
        ]
      });
    this.suppressWarnings(lambdaFunction)
  };

  private addServiceCatalog() {
    const portfolio = new servicecatalog.CfnPortfolio(
      this, 'Portfolio',
      {
        displayName: 'Compliant Framework - Tenant Services',
        providerName: 'Compliant Framework'
      });

    const s3Path = 'https://%%BUCKET_NAME%%-${AWS::Region}.s3.amazonaws.com/%%SOLUTION_NAME%%/%%VERSION%%/'

    const avmForGovCloudProductV100 = new servicecatalog.CfnCloudFormationProduct(
      this, 'AvmForGovCloudProductV100',
      {
        name: 'Account Vending Machine for AWS GovCloud (US)',
        distributor: 'Compliant Framework',
        owner: 'Compliant Framework',
        description: 'Creates a new GovCloud account using the ' +
          'CreateGovCloudAccount API. This product requires the creation of ' +
          'AWS CLI Keys for the Central GovCloud account with the proper ' +
          'permissions and stored as ' +
          '/compliant/framework/central-avm/aws-us-gov/access-key-id and ' +
          '/compliant/framework/central-avm/aws-us-gov/secret-access-key ' +
          'into SSM Parameter Store. Please see the implementation guide ' +
          'for more details on setting the IAM permissions',
        provisioningArtifactParameters: [
          {
            name: 'v1.0.0',
            info: {
              LoadTemplateFromURL:
                cdk.Fn.sub(s3Path + 'compliant-framework-govcloud-account-product-v1.0.0.yml')
            }
          }
        ]
      });

    new servicecatalog.CfnPortfolioProductAssociation(
      this, 'AvmForGovCloudV100ProductAssociation',
      {
        portfolioId: portfolio.ref,
        productId: avmForGovCloudProductV100.ref
      }
    );

  }

}