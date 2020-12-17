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

import boto3

SSM_GOVCLOUD_ACCESS_KEY_ID = '/compliant/framework/central/aws-us-gov/access-key-id'
SSM_GOVCLOUD_SECRET_ACCESS_KEY = '/compliant/framework/central/aws-us-gov/secret-access-key'

SSM_GOVCLOUD_LOGGING_ACCOUNT_ID = '/compliant/framework/accounts/core/logging/aws-us-gov/id'
SSM_GOVCLOUD_TRANSIT_ACCOUNT_ID = '/compliant/framework/accounts/prod/transit/aws-us-gov/id'
SSM_GOVCLOUD_MS_ACCOUNT_ID = '/compliant/framework/accounts/prod/management-services/aws-us-gov/id'


def invite_govcloud_account(sts_client,
                            org_client,
                            account_id):

    response = org_client.list_accounts()
    print('list_accounts')
    print(response)
    for account in response['Accounts']:
        if account['Id'] == account_id:
            print('Account already part of organization')
            return

    response = org_client.invite_account_to_organization(
        Target={
            'Id': account_id,
            'Type': 'ACCOUNT'
        }
    )
    print('invite_account_to_organization')
    print(response)

    handshake_id = response['Handshake']['Id']

    child_role = sts_client.assume_role(
        RoleArn=f'arn:aws-us-gov:iam::{account_id}:role/CompliantFrameworkAccountAccessRole',
        RoleSessionName='CompliantFrameworkInstall'
    )

    child_org_client = boto3.client(
        'organizations',
        aws_access_key_id=child_role['Credentials']['AccessKeyId'],
        aws_secret_access_key=child_role['Credentials']['SecretAccessKey'],
        aws_session_token=child_role['Credentials']['SessionToken'],
        region_name='us-gov-west-1')

    response = child_org_client.accept_handshake(HandshakeId=handshake_id)
    print('accept_handshake')
    print(response)


def lambda_handler(event, context):
    ssm_client = boto3.client('ssm')

    govcloud_access_key_id = ssm_client.get_parameter(
        Name=SSM_GOVCLOUD_ACCESS_KEY_ID
    )['Parameter']['Value']
    govcloud_secret_access_key = ssm_client.get_parameter(
        Name=SSM_GOVCLOUD_SECRET_ACCESS_KEY,
        WithDecryption=True
    )['Parameter']['Value']
    govcloud_region = 'us-gov-west-1'

    org_client_gc = boto3.client('organizations',
                                 aws_access_key_id=govcloud_access_key_id,
                                 aws_secret_access_key=govcloud_secret_access_key,
                                 region_name=govcloud_region)

    sts_client_gc = boto3.client('sts',
                                 aws_access_key_id=govcloud_access_key_id,
                                 aws_secret_access_key=govcloud_secret_access_key,
                                 region_name=govcloud_region)

    #
    logging_account_id = ssm_client.get_parameter(
        Name=SSM_GOVCLOUD_LOGGING_ACCOUNT_ID
    )['Parameter']['Value']

    transit_account_id = ssm_client.get_parameter(
        Name=SSM_GOVCLOUD_TRANSIT_ACCOUNT_ID
    )['Parameter']['Value']

    management_services_account_id = ssm_client.get_parameter(
        Name=SSM_GOVCLOUD_MS_ACCOUNT_ID
    )['Parameter']['Value']

    invite_govcloud_account(sts_client_gc, org_client_gc, logging_account_id)
    invite_govcloud_account(sts_client_gc, org_client_gc, transit_account_id)
    invite_govcloud_account(sts_client_gc, org_client_gc,
                            management_services_account_id)

    return {}
