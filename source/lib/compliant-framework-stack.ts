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

import * as codebuild from '@aws-cdk/aws-codebuild';
import * as core from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as kms from '@aws-cdk/aws-kms';
import * as lambda from '@aws-cdk/aws-lambda';
import * as logs from '@aws-cdk/aws-logs';
import * as s3 from '@aws-cdk/aws-s3';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as sns from '@aws-cdk/aws-sns';
import * as subscriptions from '@aws-cdk/aws-sns-subscriptions';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import { Duration } from '@aws-cdk/core';

import { SolutionHelper } from './solution-helper/solution-helper-construct';

import { AccountVendingMachine } from './account-vending-machine/account-vending-machine-construct'

export interface CompliantFrameworkStackProps extends cdk.StackProps {
  readonly solutionID: string,
  readonly solutionName: string
}

export class CompliantFrameworkStack extends cdk.Stack {

  //
  // Parameters
  //
  private readonly frameworkNotificationEmail =
    new cdk.CfnParameter(this, 'frameworkNotificationEmail', {
      type: 'String',
      description:
        'Specify an email address to receive notifications about this deployment',
      allowedPattern: '^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'
    });
  private readonly coreNotificationEmail = new
    cdk.CfnParameter(this, 'coreNotificationEmail', {
      type: 'String',
      description:
        'Specify an email address to receive notifications about Core Accounts.',
      allowedPattern: '^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'
    });
  private readonly environmentNotificationEmail =
    new cdk.CfnParameter(this, 'environmentNotificationEmail', {
      type: 'String',
      description:
        'Specify an email address to receive notifications about Environment Accounts.',
      allowedPattern: '^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'
    });
  private readonly useGovCloud =
    new cdk.CfnParameter(this, 'useGovCloud', {
      type: 'String',
      description:
        'Specify true to deploy the Compliant Framework into AWS GovCloud (US). If selecting GovCloud, ' +
        'verify that the current account is a GovCloud (US) / ITAR enabled master payer account ' +
        'and AWS CLI access keys have been inputted into SSM Parameter Store, per prerequisites.',
      allowedValues: ['true'],
      default: 'true'
    });
  private readonly deploymentRegion =
    new cdk.CfnParameter(this, 'deploymentRegion', {
      type: 'String',
      description:
        'Specify the region to deploy the solution into. This solution will install by default into ' +
        'us-gov-west-1. Please contact AWS Professional Services for more information about how to ' +
        'enable this solution to also deploy into us-gov-east-1.',
      allowedValues: [
        'us-gov-west-1'
      ],
      default: 'us-gov-west-1'
    });
  private readonly loggingAccountEmail =
    new cdk.CfnParameter(this, 'loggingAccountEmail', {
      type: 'String',
      description:
        'Specify an email address to use for the Logging account. This email ' +
        'address must not already be associated with another AWS account. You must use a valid ' +
        'email address to complete account creation. You can\'t access the root user of the ' +
        'account or remove an account that was created with an invalid email address.',
      allowedPattern: '^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'
    });
  private readonly transitAccountEmail =
    new cdk.CfnParameter(this, 'transitAccountEmail', {
      type: 'String',
      description:
        'Specify an email address to use for the Transit account. This email ' +
        'address must not already be associated with another AWS account. You must use a valid ' +
        'email address to complete account creation. You can\'t access the root user of the ' +
        'account or remove an account that was created with an invalid email address.',
      allowedPattern: '^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'
    });
  private readonly managementServicesAccountEmail =
    new cdk.CfnParameter(this, 'managementServicesAccountEmail', {
      type: 'String',
      description:
        'Specify an email address to use for the VDMS account. This email ' +
        'address must not already be associated with another AWS account. You must use a valid ' +
        'email address to complete account creation. You can\'t access the root user of the ' +
        'account or remove an account that was created with an invalid email address.',
      allowedPattern: '^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'
    });

  //
  // Parameters - Transit Gateway
  //
  private readonly transitGatewayAmazonSideAsn =
    new cdk.CfnParameter(this, 'transitGatewayAmazonSideAsn', {
      type: 'String',
      description:
        'This should be the ASN for the AWS side of a Border Gateway Protocol (BGP) ' +
        'session. The range is 64512 to 65534 for 16-bit ASNs. The range is ' +
        '4200000000 to 4294967294 for 32-bit ASNs. If you have a multi-region ' +
        'deployment, we recommend that you use a unique ASN for each of your ' +
        'transit gateways',
      default: '65224'
    });
  private readonly firewallAAsn =
    new cdk.CfnParameter(this, 'firewallAAsn', {
      type: 'String',
      description:
        'The range is 64512 to 65534 for 16-bit ASNs. The range is ' +
        '4200000000 to 4294967294 for 32-bit ASNs. If you have a multi-region ' +
        'deployment, we recommend that you use a unique ASN for each of your' +
        'transit gateways',
      default: '65200'
    });
  private readonly firewallBAsn =
    new cdk.CfnParameter(this, 'firewallBAsn', {
      type: 'String',
      description:
        'The range is 64512 to 65534 for 16-bit ASNs. The range is ' +
        '4200000000 to 4294967294 for 32-bit ASNs. If you have a multi-region ' +
        'deployment, we recommend that you use a unique ASN for each of your' +
        'transit gateways',
      default: '65210'
    })


  //
  // Transit - Firewall VPC
  //
  private readonly firewallVpcCidrBlock =
    new cdk.CfnParameter(this, 'firewallVpcCidrBlock', {
      type: 'String',
      default: '10.0.0.0/21'
    });
  private readonly firewallVpcNiprCidrBlock =
    new cdk.CfnParameter(this, 'firewallVpcNiprCidrBlock', {
      type: 'String',
      description:
        'If specified, an additional CIDR range will be added to the VPC. The ' +
        'external subnet CIDR blocks should reflect the usage of this NIPR based ' +
        'range.',
      default: '0.0.0.0/0'
    });
  private readonly firewallVpcInstanceTenancy =
    new cdk.CfnParameter(this, 'firewallVpcInstanceTenancy', {
      type: 'String',
      description:
        'The allowed tenancy of instances launched into the VPC.',
      allowedValues: ['default', 'dedicated'],
      default: 'default'
    });
  private readonly firewallVpcExternalSubnetACidrBlock =
    new cdk.CfnParameter(this, 'firewallVpcExternalSubnetACidrBlock', {
      type: 'String',
      default: '10.0.0.0/24'
    });
  private readonly firewallVpcExternalSubnetBCidrBlock =
    new cdk.CfnParameter(this, 'firewallVpcExternalSubnetBCidrBlock', {
      type: 'String',
      default: '10.0.1.0/24'
    });
  // private readonly firewallVpcExternalSubnetCCidrBlock =
  //   new cdk.CfnParameter(this, 'firewallVpcExternalSubnetCCidrBlock', {
  //     type: 'String',
  //     default: '10.0.2.0/24'
  //   });
  private readonly firewallVpcInternalSubnetACidrBlock =
    new cdk.CfnParameter(this, 'firewallVpcInternalSubnetACidrBlock', {
      type: 'String',
      default: '10.0.3.0/24'
    });
  private readonly firewallVpcInternalSubnetBCidrBlock =
    new cdk.CfnParameter(this, 'firewallVpcInternalSubnetBCidrBlock', {
      type: 'String',
      default: '10.0.4.0/24'
    });
  // private readonly firewallVpcInternalSubnetCCidrBlock =
  //   new cdk.CfnParameter(this, 'firewallVpcInternalSubnetCCidrBlock', {
  //     type: 'String',
  //     default: '10.0.5.0/24'
  //   });
  private readonly firewallVpcManagementSubnetACidrBlock =
    new cdk.CfnParameter(this, 'firewallVpcManagementSubnetACidrBlock', {
      type: 'String',
      default: '10.0.6.0/27'
    });
  private readonly firewallVpcManagementSubnetBCidrBlock =
    new cdk.CfnParameter(this, 'firewallVpcManagementSubnetBCidrBlock', {
      type: 'String',
      default: '10.0.6.32/27'
    });
  // private readonly firewallVpcManagementSubnetCCidrBlock =
  //   new cdk.CfnParameter(this, 'firewallVpcManagementSubnetCCidrBlock', {
  //     type: 'String',
  //     default: '10.0.6.64/27'
  //   });
  private readonly firewallVpcTransitGatewayAttachmentSubnetACidrBlock =
    new cdk.CfnParameter(this, 'firewallVpcTransitGatewayAttachmentSubnetACidrBlock', {
      type: 'String',
      default: '10.0.7.208/28'
    });
  private readonly firewallVpcTransitGatewayAttachmentSubnetBCidrBlock =
    new cdk.CfnParameter(this, 'firewallVpcTransitGatewayAttachmentSubnetBCidrBlock', {
      type: 'String',
      default: '10.0.7.224/28'
    });
  // private readonly firewallVpcTransitGatewayAttachmentSubnetCCidrBlock =
  //   new cdk.CfnParameter(this, 'firewallVpcTransitGatewayAttachmentSubnetCCidrBlock', {
  //     type: 'String',
  //     default: '10.0.7.240/28'
  //   });

  //
  // Management Services - Management Services VPC
  //
  private readonly managementServicesVpcCidrBlock =
    new cdk.CfnParameter(this, 'managementServicesVpcCidrBlock', {
      type: 'String',
      default: '10.0.20.0/22'
    });
  private readonly managementServicesVpcInstanceTenancy =
    new cdk.CfnParameter(this, 'managementServicesVpcInstanceTenancy', {
      type: 'String',
      description:
        'The allowed tenancy of instances launched into the VPC.',
      allowedValues: ['default', 'dedicated'],
      default: 'default'
    });
  private readonly managementServicesVpcApplicationSubnetACidrBlock =
    new cdk.CfnParameter(this, 'managementServicesVpcApplicationSubnetACidrBlock', {
      type: 'String',
      default: '10.0.20.0/24'
    });
  private readonly managementServicesVpcApplicationSubnetBCidrBlock =
    new cdk.CfnParameter(this, 'managementServicesVpcApplicationSubnetBCidrBlock', {
      type: 'String',
      default: '10.0.21.0/24'
    });
  // private readonly managementServicesVpcApplicationSubnetCCidrBlock =
  //   new cdk.CfnParameter(this, 'managementServicesVpcApplicationSubnetCCidrBlock', {
  //     type: 'String',
  //     default: '10.0.22.0/24'
  //   });
  private readonly managementServicesVpcDataSubnetACidrBlock =
    new cdk.CfnParameter(this, 'managementServicesVpcDataSubnetACidrBlock', {
      type: 'String',
      default: '10.0.23.0/26'
    });
  private readonly managementServicesVpcDataSubnetBCidrBlock =
    new cdk.CfnParameter(this, 'managementServicesVpcDataSubnetBCidrBlock', {
      type: 'String',
      default: '10.0.23.64/26'
    });
  // private readonly managementServicesVpcDataSubnetCCidrBlock =
  //   new cdk.CfnParameter(this, 'managementServicesVpcDataSubnetCCidrBlock', {
  //     type: 'String',
  //     default: '10.0.23.128/26'
  //   });
  private readonly managementServicesVpcTransitGatewayAttachmentSubnetACidrBlock =
    new cdk.CfnParameter(this, 'managementServicesVpcTransitGatewayAttachmentSubnetACidrBlock', {
      type: 'String',
      default: '10.0.23.208/28'
    });
  private readonly managementServicesVpcTransitGatewayAttachmentSubnetBCidrBlock =
    new cdk.CfnParameter(this, 'managementServicesVpcTransitGatewayAttachmentSubnetBCidrBlock', {
      type: 'String',
      default: '10.0.23.224/28'
    });
  // private readonly managementServicesVpcTransitGatewayAttachmentSubnetCCidrBlock =
  //   new cdk.CfnParameter(this, 'managementServicesVpcTransitGatewayAttachmentSubnetCCidrBlock', {
  //     type: 'String',
  //     default: '10.0.23.240/28'
  //   });

  //
  // Management Services - External Access VPC
  //
  private readonly externalAccessVpcCidrBlock = new
    cdk.CfnParameter(this, 'externalAccessVpcCidrBlock', {
      type: 'String',
      default: '10.0.24.0/22'
    });
  private readonly externalAccessVpcInstanceTenancy =
    new cdk.CfnParameter(this, 'externalAccessVpcInstanceTenancy', {
      type: 'String',
      description:
        'The allowed tenancy of instances launched into the VPC.',
      allowedValues: ['default', 'dedicated'],
      default: 'default'
    });
  private readonly externalAccessVpcPublicSubnetACidrBlock =
    new cdk.CfnParameter(this, 'externalAccessVpcPublicSubnetACidrBlock', {
      type: 'String',
      default: '10.0.24.0/27'
    });
  private readonly externalAccessVpcPublicSubnetBCidrBlock =
    new cdk.CfnParameter(this, 'externalAccessVpcPublicSubnetBCidrBlock', {
      type: 'String',
      default: '10.0.24.32/27'
    });
  // private readonly externalAccessVpcPublicSubnetCCidrBlock =
  //   new cdk.CfnParameter(this, 'externalAccessVpcPublicSubnetCCidrBlock', {
  //     type: 'String',
  //     default: '10.0.24.64/27'
  //   });
  private readonly externalAccessVpcApplicationSubnetACidrBlock =
    new cdk.CfnParameter(this, 'externalAccessVpcApplicationSubnetACidrBlock', {
      type: 'String',
      default: '10.0.24.96/27'
    });
  private readonly externalAccessVpcApplicationSubnetBCidrBlock =
    new cdk.CfnParameter(this, 'externalAccessVpcApplicationSubnetBCidrBlock', {
      type: 'String',
      default: '10.0.24.128/27'
    });
  // private readonly externalAccessVpcApplicationSubnetCCidrBlock =
  //   new cdk.CfnParameter(this, 'externalAccessVpcApplicationSubnetCCidrBlock', {
  //     type: 'String',
  //     default: '10.0.24.160/27'
  //   });
  private readonly externalAccessVpcTransitGatewayAttachmentSubnetACidrBlock =
    new cdk.CfnParameter(this, 'externalAccessVpcTransitGatewayAttachmentSubnetACidrBlock', {
      type: 'String',
      default: '10.0.24.208/28'
    });
  private readonly externalAccessVpcTransitGatewayAttachmentSubnetBCidrBlock =
    new cdk.CfnParameter(this, 'externalAccessVpcTransitGatewayAttachmentSubnetBCidrBlock', {
      type: 'String',
      default: '10.0.24.224/28'
    });
  // private readonly externalAccessVpcTransitGatewayAttachmentSubnetCCidrBlock =
  //   new cdk.CfnParameter(this, 'externalAccessVpcTransitGatewayAttachmentSubnetCCidrBlock', {
  //     type: 'String',
  //     default: '10.0.24.240/28'
  //   });

  //
  // Management Services - Directory VPC
  //
  private readonly directoryVpcCidrBlock =
    new cdk.CfnParameter(this, 'directoryVpcCidrBlock', {
      type: 'String',
      default: '10.0.10.0/24'
    });
  private readonly directoryVpcInstanceTenancy =
    new cdk.CfnParameter(this, 'directoryVpcInstanceTenancy', {
      type: 'String',
      description:
        'The allowed tenancy of instances launched into the VPC. ' +
        'If you intend to use AWS Managed AD, \'default\' is required',
      allowedValues: ['default', 'dedicated'],
      default: 'default'
    });
  private readonly directoryVpcApplicationSubnetACidrBlock =
    new cdk.CfnParameter(this, 'directoryVpcApplicationSubnetACidrBlock', {
      type: 'String',
      default: '10.0.10.0/27'
    });
  private readonly directoryVpcApplicationSubnetBCidrBlock =
    new cdk.CfnParameter(this, 'directoryVpcApplicationSubnetBCidrBlock', {
      type: 'String',
      default: '10.0.10.32/27'
    });
  // private readonly directoryVpcApplicationSubnetCCidrBlock =
  //   new cdk.CfnParameter(this, 'directoryVpcApplicationSubnetCCidrBlock', {
  //     type: 'String',
  //     default: '10.0.10.64/27'
  //   });
  private readonly directoryVpcDataSubnetACidrBlock =
    new cdk.CfnParameter(this, 'directoryVpcDataSubnetACidrBlock', {
      type: 'String',
      default: '10.0.10.96/27'
    });
  private readonly directoryVpcDataSubnetBCidrBlock =
    new cdk.CfnParameter(this, 'directoryVpcDataSubnetBCidrBlock', {
      type: 'String',
      default: '10.0.10.128/27'
    });
  // private readonly directoryVpcDataSubnetCCidrBlock =
  //   new cdk.CfnParameter(this, 'directoryVpcDataSubnetCCidrBlock', {
  //     type: 'String',
  //     default: '10.0.10.160/27'
  //   });
  private readonly directoryVpcTransitGatewayAttachmentSubnetACidrBlock =
    new cdk.CfnParameter(this, 'directoryVpcTransitGatewayAttachmentSubnetACidrBlock', {
      type: 'String',
      default: '10.0.10.208/28'
    });
  private readonly directoryVpcTransitGatewayAttachmentSubnetBCidrBlock =
    new cdk.CfnParameter(this, 'directoryVpcTransitGatewayAttachmentSubnetBCidrBlock', {
      type: 'String',
      default: '10.0.10.224/28'
    });
  // private readonly directoryVpcTransitGatewayAttachmentSubnetCCidrBlock =
  //   new cdk.CfnParameter(this, 'directoryVpcTransitGatewayAttachmentSubnetCCidrBlock', {
  //     type: 'String',
  //     default: '10.0.10.240/28'
  //   });

  /**
   *
   * @param scope
   * @param id
   * @param props
   */
  constructor(scope: cdk.Construct, id: string, props: CompliantFrameworkStackProps) {
    super(scope, id, props);
    this.configureParameterMetadata()
    this.addStepFunction()

    new AccountVendingMachine(this, 'AccountVendingMachine')

    // This solution includes an option to send anonymous operational metrics to
    // AWS. We use this data to better understand how customers use this
    // solution and related services and products
    new SolutionHelper(this, 'SolutionHelper', { solutionId: props.solutionID });
  }

  /**
   *
   */
  private configureParameterMetadata() {
    this.templateOptions.metadata = {
      'AWS::CloudFormation::Interface': {
        ParameterGroups: [
          {
            Label: { default: 'Compliant Framework Configuration' },
            Parameters: [
              this.frameworkNotificationEmail.logicalId,
              this.coreNotificationEmail.logicalId,
              this.environmentNotificationEmail.logicalId,
              this.loggingAccountEmail.logicalId,
              this.transitAccountEmail.logicalId,
              this.managementServicesAccountEmail.logicalId,
              this.useGovCloud.logicalId,
              this.deploymentRegion.logicalId,
            ]
          },
          {
            Label: { default: 'Transit Gateway Configuration' },
            Parameters: [
              this.transitGatewayAmazonSideAsn.logicalId,
              this.firewallAAsn.logicalId,
              this.firewallBAsn.logicalId,
            ]
          },
          {
            Label: { default: 'Transit Account - Firewall VPC Configuration' },
            Parameters: [
              this.firewallVpcCidrBlock.logicalId,
              this.firewallVpcNiprCidrBlock.logicalId,
              this.firewallVpcInstanceTenancy.logicalId,
              this.firewallVpcExternalSubnetACidrBlock.logicalId,
              this.firewallVpcExternalSubnetBCidrBlock.logicalId,
              this.firewallVpcInternalSubnetACidrBlock.logicalId,
              this.firewallVpcInternalSubnetBCidrBlock.logicalId,
              this.firewallVpcManagementSubnetACidrBlock.logicalId,
              this.firewallVpcManagementSubnetBCidrBlock.logicalId,
              this.firewallVpcTransitGatewayAttachmentSubnetACidrBlock.logicalId,
              this.firewallVpcTransitGatewayAttachmentSubnetBCidrBlock.logicalId,
            ]
          },
          {
            Label: { default: 'Management Services VPC Configuration' },
            Parameters: [
              this.managementServicesVpcCidrBlock.logicalId,
              this.managementServicesVpcInstanceTenancy.logicalId,
              this.managementServicesVpcApplicationSubnetACidrBlock.logicalId,
              this.managementServicesVpcApplicationSubnetBCidrBlock.logicalId,
              this.managementServicesVpcDataSubnetACidrBlock.logicalId,
              this.managementServicesVpcDataSubnetBCidrBlock.logicalId,
              this.managementServicesVpcTransitGatewayAttachmentSubnetACidrBlock.logicalId,
              this.managementServicesVpcTransitGatewayAttachmentSubnetBCidrBlock.logicalId,
            ]
          },
          {
            Label: { default: 'External Access VPC Configuration' },
            Parameters: [
              this.externalAccessVpcCidrBlock.logicalId,
              this.externalAccessVpcInstanceTenancy.logicalId,
              this.externalAccessVpcPublicSubnetACidrBlock.logicalId,
              this.externalAccessVpcPublicSubnetBCidrBlock.logicalId,
              this.externalAccessVpcApplicationSubnetACidrBlock.logicalId,
              this.externalAccessVpcApplicationSubnetBCidrBlock.logicalId,
              this.externalAccessVpcTransitGatewayAttachmentSubnetACidrBlock.logicalId,
              this.externalAccessVpcTransitGatewayAttachmentSubnetBCidrBlock.logicalId,
            ]
          },
          {
            Label: { default: 'Directory VPC Configuration' },
            Parameters: [
              this.directoryVpcCidrBlock.logicalId,
              this.directoryVpcInstanceTenancy.logicalId,
              this.directoryVpcApplicationSubnetACidrBlock.logicalId,
              this.directoryVpcApplicationSubnetBCidrBlock.logicalId,
              this.directoryVpcDataSubnetACidrBlock.logicalId,
              this.directoryVpcDataSubnetBCidrBlock.logicalId,
              this.directoryVpcTransitGatewayAttachmentSubnetACidrBlock.logicalId,
              this.directoryVpcTransitGatewayAttachmentSubnetBCidrBlock.logicalId,
            ]
          },
        ],
        ParameterLabels: {
          [this.frameworkNotificationEmail.logicalId]: { default: 'Deployment Notifications Email' },
          [this.coreNotificationEmail.logicalId]: { default: 'Core Notifications Email' },
          [this.environmentNotificationEmail.logicalId]: { default: 'Environment Notifications Email' },
          [this.loggingAccountEmail.logicalId]: { default: 'Logging Account Email' },
          [this.transitAccountEmail.logicalId]: { default: 'Transit Account Email' },
          [this.managementServicesAccountEmail.logicalId]: { default: 'Management Services Account Email' },
          [this.useGovCloud.logicalId]: { default: 'Use AWS GovCloud (US)?' },
          [this.deploymentRegion.logicalId]: { default: 'Deployment Region' },
          [this.transitGatewayAmazonSideAsn.logicalId]: { default: 'Amazon Side Autonomous System Number (ASN)' },
          [this.firewallAAsn.logicalId]: { default: 'Firewall A (ASN)' },
          [this.firewallBAsn.logicalId]: { default: 'Firewall B (ASN)' },

          [this.firewallVpcCidrBlock.logicalId]: { default: 'Firewall VPC CIDR' },
          [this.firewallVpcNiprCidrBlock.logicalId]: { default: '(Optional) Firewall VPC NIPR CIDR' },
          [this.firewallVpcInstanceTenancy.logicalId]: { default: 'VPC Instance Tenancy' },
          [this.firewallVpcExternalSubnetACidrBlock.logicalId]: { default: 'External Subnet CIDR Block - Availability Zone A' },
          [this.firewallVpcExternalSubnetBCidrBlock.logicalId]: { default: 'External Subnet CIDR Block - Availability Zone B' },
          [this.firewallVpcInternalSubnetACidrBlock.logicalId]: { default: 'Internal Subnet CIDR Block - Availability Zone A' },
          [this.firewallVpcInternalSubnetBCidrBlock.logicalId]: { default: 'Internal Subnet CIDR Block - Availability Zone B' },
          [this.firewallVpcManagementSubnetACidrBlock.logicalId]: { default: 'Management Subnet CIDR Block - Availability Zone A' },
          [this.firewallVpcManagementSubnetBCidrBlock.logicalId]: { default: 'Management Subnet CIDR Block - Availability Zone B' },
          [this.firewallVpcTransitGatewayAttachmentSubnetACidrBlock.logicalId]: { default: 'Transit Gateway Attachment Subnet CIDR Block - Availability Zone A' },
          [this.firewallVpcTransitGatewayAttachmentSubnetBCidrBlock.logicalId]: { default: 'Transit Gateway Attachment Subnet CIDR Block - Availability Zone B' },

          [this.managementServicesVpcCidrBlock.logicalId]: { default: 'Management Services VPC CIDR' },
          [this.managementServicesVpcInstanceTenancy.logicalId]: { default: 'VPC Instance Tenancy' },
          [this.managementServicesVpcApplicationSubnetACidrBlock.logicalId]: { default: 'Application Subnet CIDR - Availability Zone A' },
          [this.managementServicesVpcApplicationSubnetBCidrBlock.logicalId]: { default: 'Application Subnet CIDR - Availability Zone B' },
          [this.managementServicesVpcDataSubnetACidrBlock.logicalId]: { default: 'Data Subnet CIDR - Availability Zone A' },
          [this.managementServicesVpcDataSubnetBCidrBlock.logicalId]: { default: 'Data Subnet CIDR - Availability Zone B' },
          [this.managementServicesVpcTransitGatewayAttachmentSubnetACidrBlock.logicalId]: { default: 'Transit Gateway Attachment Subnet CIDR - Availability Zone A' },
          [this.managementServicesVpcTransitGatewayAttachmentSubnetBCidrBlock.logicalId]: { default: 'Transit Gateway Attachment Subnet CIDR - Availability Zone B' },

          [this.externalAccessVpcCidrBlock.logicalId]: { default: 'External Access VPC CIDR' },
          [this.externalAccessVpcInstanceTenancy.logicalId]: { default: 'VPC Instance Tenancy' },
          [this.externalAccessVpcPublicSubnetACidrBlock.logicalId]: { default: 'Public Subnet CIDR - Availability Zone A' },
          [this.externalAccessVpcPublicSubnetBCidrBlock.logicalId]: { default: 'Public Subnet CIDR - Availability Zone B' },
          [this.externalAccessVpcApplicationSubnetACidrBlock.logicalId]: { default: 'Application Subnet CIDR - Availability Zone A' },
          [this.externalAccessVpcApplicationSubnetBCidrBlock.logicalId]: { default: 'Application Subnet CIDR - Availability Zone B' },
          [this.externalAccessVpcTransitGatewayAttachmentSubnetACidrBlock.logicalId]: { default: 'Transit Gateway Attachment Subnet CIDR - Availability Zone A' },
          [this.externalAccessVpcTransitGatewayAttachmentSubnetBCidrBlock.logicalId]: { default: 'Transit Gateway Attachment Subnet CIDR - Availability Zone B' },

          [this.directoryVpcCidrBlock.logicalId]: { default: 'Directory VPC CIDR' },
          [this.directoryVpcInstanceTenancy.logicalId]: { default: 'VPC Instance Tenancy' },
          [this.directoryVpcApplicationSubnetACidrBlock.logicalId]: { default: 'Application Subnet CIDR - Availability Zone A' },
          [this.directoryVpcApplicationSubnetBCidrBlock.logicalId]: { default: 'Application Subnet CIDR - Availability Zone B' },
          [this.directoryVpcDataSubnetACidrBlock.logicalId]: { default: 'Data Subnet CIDR - Availability Zone A' },
          [this.directoryVpcDataSubnetBCidrBlock.logicalId]: { default: 'Data Subnet CIDR - Availability Zone B' },
          [this.directoryVpcTransitGatewayAttachmentSubnetACidrBlock.logicalId]: { default: 'Transit Gateway Attachment Subnet CIDR - Availability Zone A' },
          [this.directoryVpcTransitGatewayAttachmentSubnetBCidrBlock.logicalId]: { default: 'Transit Gateway Attachment Subnet CIDR - Availability Zone B' },

        }
      }
    }
  }

  /**
   *
   */
  private addStepFunction() {

    const alertSubscriptionCmk = new kms.Key(this, 'alertSubscriptionCmk', {
      enableKeyRotation: true
    })
    const alertSubscriptionCmkAlias = new kms.Alias(this, 'alertSubscriptionCmkAlias', {
      aliasName: 'alias/compliant-framework/notification-email/topic/cmk',
      targetKey: alertSubscriptionCmk
    })

    const alertSubscription = new subscriptions.EmailSubscription(
      this.frameworkNotificationEmail.valueAsString);
    const alertTopic = new sns.Topic(this, 'alertTopic', {
      displayName: 'Compliant Framework Info',
      masterKey: alertSubscriptionCmkAlias
    });
    alertTopic.addSubscription(alertSubscription);

    //
    // Base Tasks
    //
    const startTask = new sfn.Pass(this, 'Begin State Function', {})
    const failTask = new sfn.Fail(this, 'Failed')

    // Notify Success Task
    const notifySuccessTask = this.addStepFunctionNotifySuccess(alertTopic, alertSubscriptionCmk)

    // Notify Failure Task
    const notifyFailureTask = this.addStepFunctionNotifyFailure(alertTopic, alertSubscriptionCmk)
      .next(failTask);


    // Verify SNS Subscriptions Task
    const verifySnsSubscriptionTask = this.addStepFunctionVerifySnsSubscription(alertTopic)
      .addRetry({
        maxAttempts: 5,
        interval: cdk.Duration.seconds(30),
      }).addCatch(notifyFailureTask)

    // Verify GovCloud API Keys Task
    const verifyGovCloudApiKeysTask = this.addStepFunctionVerifyGovCloudApiKeys()
      .addCatch(notifyFailureTask)

    // Initialize Organization Task
    const initializeOrganizationTask = this.addStepFunctionInitializeOrganization()
      .addCatch(notifyFailureTask)

    // Create Accounts Task
    const createAccountsTask = this.addStepFunctionCreateAccounts()
      .addCatch(notifyFailureTask)

    // Invite Accounts Task
    const inviteAccountsTask = this.addStepFunctionInviteAccounts()
      .addRetry({
        maxAttempts: 5,
        interval: cdk.Duration.seconds(30),
      }).addCatch(notifyFailureTask);


    // Deploy Framework (into GovCloud)
    const codebuildTask = this.addStepFunctionDeployFramework()
      .addCatch(notifyFailureTask);

    //
    // State Machine
    //
    const stateMachineLogGroup = new logs.LogGroup(this, 'stateMachineLogGroup', {
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    const definition = startTask
      .next(verifySnsSubscriptionTask)
      .next(verifyGovCloudApiKeysTask)
      .next(initializeOrganizationTask)
      .next(createAccountsTask)
      .next(inviteAccountsTask)
      .next(codebuildTask)
      .next(notifySuccessTask);

    const stateMachine = new sfn.StateMachine(this, 'stateMachine', {
      definition,
      stateMachineName: 'CompliantFramework',
      logs: {
        destination: stateMachineLogGroup,
        level: sfn.LogLevel.ALL,
      }
    });

    const cfnStateMachineDefPolicy = stateMachine.role?.node.tryFindChild('DefaultPolicy')?.node.findChild('Resource') as iam.CfnPolicy;
    cfnStateMachineDefPolicy.cfnOptions.metadata = {
      cfn_nag: {
        rules_to_suppress: [
          {
            id: 'W12',
            reason: `State machine permission actions require use of * resource`
          },
          {
            id: 'W76',
            reason: `SPCM for IAM policy document is higher than 25`
          }
        ]
      }
    };

    //
    // Kick off the State Machine
    //
    this.executeStateMachine(stateMachine.stateMachineArn)

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


  /**
   *
   * @param alertTopic
   */
  private addStepFunctionNotifySuccess(
    alertTopic: sns.Topic,
    alertSubscriptionCmk: kms.Key
  ): tasks.LambdaInvoke {
    const functionName = 'CompliantFramework-NotifySuccessFunction'

    const lambdaFunction = new lambda.Function(this, 'notifySuccessFunction', {
      functionName,
      code: new lambda.AssetCode('lambda/notify_success'),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(300),
      runtime: lambda.Runtime.PYTHON_3_8,
      environment: {
        ['SNS_TOPIC_ARN']: alertTopic.topicArn
      },
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents'
          ],
          resources: [this.formatArn({
            service: 'logs',
            resource: 'log-group',
            sep: ':',
            resourceName: functionName
          })]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'sns:Publish'
          ],
          resources: [alertTopic.topicArn]
        })
      ]
    })
    this.suppressWarnings(lambdaFunction)
    alertSubscriptionCmk.grantEncryptDecrypt(lambdaFunction)

    return new tasks.LambdaInvoke(this, 'Notify Success', {
      lambdaFunction,
      payload: sfn.TaskInput.fromDataAt('$')
    })
  }

  /**
   *
   * @param alertTopic
   */
  private addStepFunctionNotifyFailure(
    alertTopic: sns.Topic,
    alertSubscriptionCmk: kms.Key
  ): tasks.LambdaInvoke {
    const functionName = 'CompliantFramework-NotifyFailureFunction'

    const lambdaFunction = new lambda.Function(this, 'notifyFailureFunction', {
      functionName,
      code: new lambda.AssetCode('lambda/notify_failure'),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(300),
      runtime: lambda.Runtime.PYTHON_3_8,
      environment: {
        ['SNS_TOPIC_ARN']: alertTopic.topicArn
      },
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents'
          ],
          resources: [this.formatArn({
            service: 'logs',
            resource: 'log-group',
            sep: ':',
            resourceName: functionName
          })]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'sns:Publish'
          ],
          resources: [alertTopic.topicArn]
        })
      ]
    })
    this.suppressWarnings(lambdaFunction)
    alertSubscriptionCmk.grantEncryptDecrypt(lambdaFunction)

    return new tasks.LambdaInvoke(this, 'Notify Failure', {
      lambdaFunction,
      payload: sfn.TaskInput.fromDataAt('$.Cause')
    })
  }

  /**
   *
   * @param alertTopic
   */
  private addStepFunctionVerifySnsSubscription(
    alertTopic: sns.Topic,
  ): tasks.LambdaInvoke {
    const functionName = 'CompliantFramework-VerifySnsSubscriptionFunction'

    const lambdaFunction = new lambda.Function(this, 'verifySnsSubscriptionFunction', {
      functionName,
      code: new lambda.AssetCode('lambda/verify_sns_subscription'),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(300),
      runtime: lambda.Runtime.PYTHON_3_8,
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents'
          ],
          resources: [this.formatArn({
            service: 'logs',
            resource: 'log-group',
            sep: ':',
            resourceName: functionName
          })]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'sns:GetTopicAttributes'
          ],
          resources: [alertTopic.topicArn]
        })
      ]
    });
    this.suppressWarnings(lambdaFunction)

    return new tasks.LambdaInvoke(this, 'Verify SNS Subscription', {
      lambdaFunction,
      payload: sfn.TaskInput.fromText(JSON.stringify(
        {
          'SnsTopicArn': alertTopic.topicArn
        }
      ))
    })
  }


  /**
   *
   * @param alertTopic
   */
  private addStepFunctionVerifyGovCloudApiKeys(): tasks.LambdaInvoke {
    const functionName = 'CompliantFramework-VerifyGovCloudApiKeys'

    const lambdaFunction = new lambda.Function(this, 'verifyGovCloudApiKeysFunction', {
      functionName,
      code: new lambda.AssetCode('lambda/verify_govcloud_api_keys'),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(300),
      runtime: lambda.Runtime.PYTHON_3_8,
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents'
          ],
          resources: [this.formatArn({
            service: 'logs',
            resource: 'log-group',
            sep: ':',
            resourceName: functionName
          })]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'ssm:GetParameter'
          ],
          resources: [this.formatArn({
            service: 'ssm',
            resource: 'parameter',
            sep: '/',
            resourceName: '*'
          })]
        })
      ]
    });
    this.suppressWarnings(lambdaFunction)

    return new tasks.LambdaInvoke(this, 'Verify GovCloud API Keys', {
      lambdaFunction
    })
  }

  /**
   *
   * @param alertTopic
   */
  private addStepFunctionInitializeOrganization(): tasks.LambdaInvoke {
    const functionName = 'CompliantFramework-InitializeOrganization'

    const lambdaFunction = new lambda.Function(this, 'initializeOrganizationFunction', {
      functionName,
      code: new lambda.AssetCode('lambda/initialize_organization'),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(300),
      runtime: lambda.Runtime.PYTHON_3_8,
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents'
          ],
          resources: [this.formatArn({
            service: 'logs',
            resource: 'log-group',
            sep: ':',
            resourceName: functionName
          })]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'ssm:GetParameter'
          ],
          resources: [this.formatArn({
            service: 'ssm',
            resource: 'parameter',
            sep: '/',
            resourceName: '*'
          })]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'organizations:ListRoots',
            'organizations:DescribeOrganization',
            'organizations:CreateOrganization'
          ],
          resources: ['*']
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'organizations:ListOrganizationalUnitsForParent',
            'organizations:CreateOrganizationalUnit',
          ],
          resources: [
            this.formatArn({
              service: 'organizations',
              region: '',
              resource: 'ou',
              sep: '/',
              resourceName: 'o-*/ou-*'
            }),
            this.formatArn({
              service: 'organizations',
              region: '',
              resource: 'root',
              sep: '/',
              resourceName: 'o-*/r-*'
            })
          ]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'iam:CreateServiceLinkedRole'
          ],
          resources: [
            this.formatArn({
              service: 'iam',
              region: '',
              account: '*',
              resource: 'role',
              sep: '/',
              resourceName: 'aws-service-role/*'
            })
          ]
        })
      ]
    })
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

    return new tasks.LambdaInvoke(this, 'Initialize Organization', {
      lambdaFunction
    })
  }

  /**
   *
   * @param alertTopic
   */
  private addStepFunctionCreateAccounts(): tasks.LambdaInvoke {
    const functionName = 'CompliantFramework-CreateAccounts'

    const lambdaFunction = new lambda.Function(this, 'createAccountsFunction', {
      functionName,
      code: new lambda.AssetCode('lambda/create_accounts'),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(900),
      runtime: lambda.Runtime.PYTHON_3_8,
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents'
          ],
          resources: [this.formatArn({
            service: 'logs',
            resource: 'log-group',
            sep: ':',
            resourceName: functionName
          })]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'ssm:PutParameter'
          ],
          resources: [this.formatArn({
            service: 'ssm',
            resource: 'parameter',
            sep: '/',
            resourceName: '*'
          })]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'organizations:ListAccounts',
            'organizations:CreateGovCloudAccount',
            'organizations:DescribeCreateAccountStatus'
          ],
          resources: ['*']
        })
      ]
    })
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

    return new tasks.LambdaInvoke(this, 'Create Accounts', {
      lambdaFunction,
      payload: sfn.TaskInput.fromText(JSON.stringify(
        {
          'LoggingAccountEmail': this.loggingAccountEmail.valueAsString,
          'ManagementServicesAccountEmail': this.managementServicesAccountEmail.valueAsString,
          'TransitAccountEmail': this.transitAccountEmail.valueAsString
        }
      ))
    })
  }

  /**
   *
   * @param alertTopic
   */
  private addStepFunctionDeployFramework(): tasks.CodeBuildStartBuild {
    const stack = core.Stack.of(this);

    const codebuildProject = new codebuild.Project(this, 'codebuildProject', {
      projectName: 'CompliantFramework',
      source: codebuild.Source.s3({
        bucket: s3.Bucket.fromBucketName(this, 'codebuildProjectBucket', '%%BUCKET_NAME%%-' + stack.region),
        path: '%%SOLUTION_NAME%%/%%VERSION%%/repos.zip',
      }),
      timeout: Duration.hours(4),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_3_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        ['STACK_NAME']: { value: core.Aws.STACK_NAME },
        ['VERSION']: { value: '%%VERSION%%' },
      }
    });

    codebuildProject.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ssm:GetParameter',
          'ssm:GetParameters'
        ],
        resources: [this.formatArn({
          service: 'ssm',
          resource: 'parameter',
          sep: '/',
          resourceName: '*'
        })]
      }));

    codebuildProject.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:DescribeStacks'
        ],
        resources: [this.formatArn({
          service: 'cloudformation',
          resource: 'stack',
          sep: '/',
          resourceName: core.Aws.STACK_NAME + '/*'
        })]
      }));

    codebuildProject.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'organizations:DescribeOrganization',
          'organizations:EnableAWSServiceAccess'
        ],
        resources: ['*']
      }));

    const cfnCodeBuildDefPolicy = codebuildProject.role?.node.tryFindChild('DefaultPolicy')?.node.findChild('Resource') as iam.CfnPolicy;
    cfnCodeBuildDefPolicy.cfnOptions.metadata = {
      cfn_nag: {
        rules_to_suppress: [{
          id: 'W12',
          reason: `CodeBuild project permission actions require use of * resource`
        }]
      }
    };

    return new tasks.CodeBuildStartBuild(this, 'Deploy Framework', {
      project: codebuildProject,
      integrationPattern: sfn.IntegrationPattern.RUN_JOB
    });
  }

  /**
   *
   * @param alertTopic
   */
  private addStepFunctionInviteAccounts(): tasks.LambdaInvoke {
    const functionName = 'CompliantFramework-InviteAccounts'

    const lambdaFunction = new lambda.Function(this, 'inviteAccountsFunction', {
      functionName,
      code: new lambda.AssetCode('lambda/invite_accounts'),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(900),
      runtime: lambda.Runtime.PYTHON_3_8,
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents'
          ],
          resources: [this.formatArn({
            service: 'logs',
            resource: 'log-group',
            sep: ':',
            resourceName: functionName
          })]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'ssm:GetParameter'
          ],
          resources: [this.formatArn({
            service: 'ssm',
            resource: 'parameter',
            sep: '/',
            resourceName: '*'
          })]
        })
      ]
    })
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

    return new tasks.LambdaInvoke(this, 'Invite Accounts', {
      lambdaFunction,
      payload: sfn.TaskInput.fromText(JSON.stringify(
        {
          'LoggingAccountEmail': this.loggingAccountEmail.valueAsString,
          'ManagementServicesAccountEmail': this.managementServicesAccountEmail.valueAsString,
          'TransitAccountEmail': this.transitAccountEmail.valueAsString
        }
      ))
    })
  }


  /**
   *
   * @param stateMachineArn
   */
  private executeStateMachine(stateMachineArn: string) {

    const functionName = 'CompliantFramework-ExecuteStateMachine'

    const lambdaFunction =
      new lambda.Function(this, 'executeStateMachineFunction', {
        functionName,
        code: new lambda.AssetCode('lambda/execute_state_machine'),
        handler: 'index.lambda_handler',
        timeout: cdk.Duration.seconds(600),
        runtime: lambda.Runtime.PYTHON_3_8,
        environment: {
          ['STATE_MACHINE_ARN']: stateMachineArn
        },
        initialPolicy: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              'logs:CreateLogGroup',
              'logs:CreateLogStream',
              'logs:PutLogEvents'
            ],
            resources: [this.formatArn({
              service: 'logs',
              resource: 'log-group',
              sep: ':',
              resourceName: functionName
            })]
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              'states:StartExecution'
            ],
            resources: [stateMachineArn]
          })
        ]
      });
    this.suppressWarnings(lambdaFunction)

    new cdk.CustomResource(this, 'executeStateMachine', {
      serviceToken: lambdaFunction.functionArn,
      properties: {
        ['Date']: new Date().toLocaleString()
      }
    });
  }



}






