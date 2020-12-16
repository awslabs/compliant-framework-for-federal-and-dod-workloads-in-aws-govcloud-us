######################################################################################################################
#  Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.                                           #
#                                                                                                                    #
#  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance    #
#  with the License. A copy of the License is located at                                                             #
#                                                                                                                    #
#      http://www.apache.org/licenses/LICENSE-2.0                                                                    #
#                                                                                                                    #
#  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES #
#  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    #
#  and limitations under the License.                                                                                #
######################################################################################################################

import json
import boto3
import optparse


SSM_GOVCLOUD_CENTRAL_ACCOUNT_ID = '/compliant/framework/central/aws-us-gov/id'
SSM_GOVCLOUD_LOGGING_ACCOUNT_ID = '/compliant/framework/accounts/core/logging/aws-us-gov/id'
SSM_GOVCLOUD_TRANSIT_ACCOUNT_ID = '/compliant/framework/accounts/prod/transit/aws-us-gov/id'
SSM_GOVCLOUD_MANAGEMENT_SERVICES_ACCOUNT_ID = '/compliant/framework/accounts/prod/management-services/aws-us-gov/id'


def get_param(parameter_key):
    class ParameterNotFoundException(Exception):
        pass

    for stack in stack_data['Stacks']:
        for parameter in stack['Parameters']:
            if (parameter_key == parameter['ParameterKey']):
                return parameter['ParameterValue']

    raise ParameterNotFoundException()


def get_config():
    ssm_client = boto3.client('ssm')
    central_account_id = ssm_client.get_parameter(
        Name=SSM_GOVCLOUD_CENTRAL_ACCOUNT_ID
    )['Parameter']['Value']
    logging_account_id = ssm_client.get_parameter(
        Name=SSM_GOVCLOUD_LOGGING_ACCOUNT_ID
    )['Parameter']['Value']
    transit_account_id = ssm_client.get_parameter(
        Name=SSM_GOVCLOUD_TRANSIT_ACCOUNT_ID
    )['Parameter']['Value']
    management_services_account_id = ssm_client.get_parameter(
        Name=SSM_GOVCLOUD_MANAGEMENT_SERVICES_ACCOUNT_ID
    )['Parameter']['Value']

    return {
        'partition': 'aws-us-gov',
        'region': 'us-gov-west-1',
        'complianceSet': 'tbd',
        'core': {
            'notificationsEmail': get_param('frameworkNotificationEmail'),
            "primaryRegion": "us-gov-west-1"
        },
        "deployToRegions": [
            "us-gov-west-1"
        ],
        'environments': [
            'default'
        ],
        'stackSets': {
            'security-baseline': {
                'parameters': {
                    'pNotificationsEmail': get_param('environmentNotificationEmail')
                }
            },
            'backup-services': {
                'parameters': {}
            }
        },
        'federation': {
            'enabled': False
        },
        'central': {
            'accountId': central_account_id,
            'organizationId': organization_id,
            'ssmParameters': {
                '/compliant/framework/logging/account/id': logging_account_id,
                '/compliant/framework/central/service-catalog/provider-name': 'Central Services',
                '/compliant/framework/central/service-catalog/access-role-name': 'CompliantFrameworkAccountAccessRole'
            }
        },
        'logging': {
            'accountId': logging_account_id
        },
        'transit': {
            "us-gov-west-1": {
                'environments': {
                    'default': {
                        'accountId': transit_account_id
                    }
                },
                'enableVpcFirewall': False,
                'enableVirtualFirewall': True,
                'ssmParameters': {
                    #
                    # Transit Gateway
                    #
                    '/compliant/framework/transit/transit-gateway/amazon-side-asn': get_param('transitGatewayAmazonSideAsn'),
                    '/compliant/framework/transit/firewall-vpc/virtual-firewall/a/asn': get_param('firewallAAsn'),
                    '/compliant/framework/transit/firewall-vpc/virtual-firewall/b/asn': get_param('firewallBAsn'),

                    #
                    # Transit - Firewall VPC
                    #
                    '/compliant/framework/transit/firewall-vpc/cidr': get_param('firewallVpcCidrBlock'),
                    '/compliant/framework/transit/firewall-vpc/nipr-cidr': get_param('firewallVpcNiprCidrBlock'),
                    '/compliant/framework/transit/firewall-vpc/instance-tenancy': get_param('firewallVpcInstanceTenancy'),
                    '/compliant/framework/transit/firewall-vpc/external-subnet/a/cidr': get_param('firewallVpcExternalSubnetACidrBlock'),
                    '/compliant/framework/transit/firewall-vpc/external-subnet/b/cidr': get_param('firewallVpcExternalSubnetBCidrBlock'),
                    # '/compliant/framework/transit/firewall-vpc/external-subnet/c/cidr': get_param('firewallVpcExternalSubnetCCidrBlock'),
                    '/compliant/framework/transit/firewall-vpc/internal-subnet/a/cidr': get_param('firewallVpcInternalSubnetACidrBlock'),
                    '/compliant/framework/transit/firewall-vpc/internal-subnet/b/cidr': get_param('firewallVpcInternalSubnetBCidrBlock'),
                    # '/compliant/framework/transit/firewall-vpc/internal-subnet/c/cidr': get_param('firewallVpcInternalSubnetCCidrBlock'),
                    '/compliant/framework/transit/firewall-vpc/management-subnet/a/cidr': get_param('firewallVpcManagementSubnetACidrBlock'),
                    '/compliant/framework/transit/firewall-vpc/management-subnet/b/cidr': get_param('firewallVpcManagementSubnetBCidrBlock'),
                    # '/compliant/framework/transit/firewall-vpc/management-subnet/c/cidr': get_param('firewallVpcManagementSubnetCCidrBlock'),
                    '/compliant/framework/transit/firewall-vpc/tgw-attach-subnet/a/cidr': get_param('firewallVpcTransitGatewayAttachmentSubnetACidrBlock'),
                    '/compliant/framework/transit/firewall-vpc/tgw-attach-subnet/b/cidr': get_param('firewallVpcTransitGatewayAttachmentSubnetBCidrBlock'),
                    # '/compliant/framework/transit/firewall-vpc/tgw-attach-subnet/c/cidr': get_param('firewallVpcTransitGatewayAttachmentSubnetCCidrBlock'),
                    '/compliant/framework/transit/firewall-vpc/igw/enabled': True,
                    '/compliant/framework/transit/firewall-vpc/tgw/attached': True,
                }
            }
        },
        'managementServices': {
            "us-gov-west-1": {
                'environments': {
                    'default': {
                        'accountId': management_services_account_id
                    }
                },
                'enableDirectoryVpc': True,
                'enableExternalAccessVpc': True,
                'ssmParameters': {
                    #
                    # Management Services - Management Services VPC
                    #
                    '/compliant/framework/management-services/management-services-vpc/cidr': get_param('managementServicesVpcCidrBlock'),
                    '/compliant/framework/management-services/management-services-vpc/instance-tenancy': get_param('managementServicesVpcInstanceTenancy'),
                    '/compliant/framework/management-services/management-services-vpc/application-subnet/a/cidr': get_param('managementServicesVpcApplicationSubnetACidrBlock'),
                    '/compliant/framework/management-services/management-services-vpc/application-subnet/b/cidr': get_param('managementServicesVpcApplicationSubnetBCidrBlock'),
                    # '/compliant/framework/management-services/management-services-vpc/application-subnet/c/cidr': get_param('managementServicesVpcApplicationSubnetCCidrBlock'),
                    '/compliant/framework/management-services/management-services-vpc/data-subnet/a/cidr': get_param('managementServicesVpcDataSubnetACidrBlock'),
                    '/compliant/framework/management-services/management-services-vpc/data-subnet/b/cidr': get_param('managementServicesVpcDataSubnetBCidrBlock'),
                    # '/compliant/framework/management-services/management-services-vpc/data-subnet/c/cidr': get_param('managementServicesVpcDataSubnetCCidrBlock'),
                    '/compliant/framework/management-services/management-services-vpc/tgw-attach-subnet/a/cidr': get_param('managementServicesVpcTransitGatewayAttachmentSubnetACidrBlock'),
                    '/compliant/framework/management-services/management-services-vpc/tgw-attach-subnet/b/cidr': get_param('managementServicesVpcTransitGatewayAttachmentSubnetBCidrBlock'),
                    # '/compliant/framework/management-services/management-services-vpc/tgw-attach-subnet/c/cidr': get_param('managementServicesVpcTransitGatewayAttachmentSubnetCCidrBlock'),

                    #
                    # Management Services - External Access VPC
                    #
                    '/compliant/framework/management-services/external-access-vpc/cidr': get_param('externalAccessVpcCidrBlock'),
                    '/compliant/framework/management-services/external-access-vpc/instance-tenancy': get_param('externalAccessVpcInstanceTenancy'),
                    '/compliant/framework/management-services/external-access-vpc/public-subnet/a/cidr': get_param('externalAccessVpcPublicSubnetACidrBlock'),
                    '/compliant/framework/management-services/external-access-vpc/public-subnet/b/cidr': get_param('externalAccessVpcPublicSubnetBCidrBlock'),
                    # '/compliant/framework/management-services/external-access-vpc/public-subnet/c/cidr': get_param('externalAccessVpcPublicSubnetCCidrBlock'),
                    '/compliant/framework/management-services/external-access-vpc/application-subnet/a/cidr': get_param('externalAccessVpcApplicationSubnetACidrBlock'),
                    '/compliant/framework/management-services/external-access-vpc/application-subnet/b/cidr': get_param('externalAccessVpcApplicationSubnetBCidrBlock'),
                    # '/compliant/framework/management-services/external-access-vpc/application-subnet/c/cidr': get_param('externalAccessVpcApplicationSubnetCCidrBlock'),
                    '/compliant/framework/management-services/external-access-vpc/tgw-attach-subnet/a/cidr': get_param('externalAccessVpcTransitGatewayAttachmentSubnetACidrBlock'),
                    '/compliant/framework/management-services/external-access-vpc/tgw-attach-subnet/b/cidr': get_param('externalAccessVpcTransitGatewayAttachmentSubnetBCidrBlock'),
                    # '/compliant/framework/management-services/external-access-vpc/tgw-attach-subnet/c/cidr': get_param('externalAccessVpcTransitGatewayAttachmentSubnetCCidrBlock'),

                    #
                    # Management Services - Directory VPC
                    #
                    '/compliant/framework/management-services/directory-vpc/cidr': get_param('directoryVpcCidrBlock'),
                    '/compliant/framework/management-services/directory-vpc/instance-tenancy': get_param('directoryVpcInstanceTenancy'),
                    '/compliant/framework/management-services/directory-vpc/application-subnet/a/cidr': get_param('directoryVpcApplicationSubnetACidrBlock'),
                    '/compliant/framework/management-services/directory-vpc/application-subnet/b/cidr': get_param('directoryVpcApplicationSubnetBCidrBlock'),
                    # '/compliant/framework/management-services/directory-vpc/application-subnet/c/cidr': get_param('directoryVpcApplicationSubnetCCidrBlock'),
                    '/compliant/framework/management-services/directory-vpc/data-subnet/a/cidr': get_param('directoryVpcDataSubnetACidrBlock'),
                    '/compliant/framework/management-services/directory-vpc/data-subnet/b/cidr': get_param('directoryVpcDataSubnetBCidrBlock'),
                    # '/compliant/framework/management-services/directory-vpc/data-subnet/c/cidr': get_param('directoryVpcDataSubnetCCidrBlock'),
                    '/compliant/framework/management-services/directory-vpc/tgw-attach-subnet/a/cidr': get_param('directoryVpcTransitGatewayAttachmentSubnetACidrBlock'),
                    '/compliant/framework/management-services/directory-vpc/tgw-attach-subnet/b/cidr': get_param('directoryVpcTransitGatewayAttachmentSubnetBCidrBlock'),
                    # '/compliant/framework/management-services/directory-vpc/tgw-attach-subnet/c/cidr': get_param('directoryVpcTransitGatewayAttachmentSubnetCCidrBlock'),
                }
            }
        },
        'plugins': {
        }
    }


parser = optparse.OptionParser()
parser.add_option('--stack-name', action='store', dest='stack_name')
parser.add_option('--out-file', action='store', dest='out_file')
parser.add_option('--aws-access-key-id', action='store',
                  dest='aws_access_key_id')
parser.add_option('--aws-secret-access-key', action='store',
                  dest='aws_secret_access_key')
parser.add_option('--region', action='store', dest='region')
options, _remainder = parser.parse_args()

# Get the Organization ID
org_client_gc = boto3.client('organizations',
                             aws_access_key_id=options.aws_access_key_id,
                             aws_secret_access_key=options.aws_secret_access_key,
                             region_name=options.region)
organization_id = org_client_gc.describe_organization()['Organization']['Id']

# Get the input parameters
cfn_client = boto3.client('cloudformation')
stack_data = cfn_client.describe_stacks(StackName=options.stack_name)

# Create the config, write to file
config = get_config()
with open(options.out_file, "w") as f:
    f.write(json.dumps(config, indent=2, default=str))
