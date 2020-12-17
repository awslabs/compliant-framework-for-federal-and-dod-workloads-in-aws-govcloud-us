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

import time
import sys
import cfnresponse
import boto3


def invite_govcloud_account(sts_client, org_client, account_id, region):
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
        RoleSessionName='CreateGovCloudAccountRole'
    )
    child_org_client = boto3.client(
        'organizations',
        aws_access_key_id=child_role['Credentials']['AccessKeyId'],
        aws_secret_access_key=child_role['Credentials']['SecretAccessKey'],
        aws_session_token=child_role['Credentials']['SessionToken'],
        region_name=region)

    response = child_org_client.accept_handshake(HandshakeId=handshake_id)
    print('accept_handshake')
    print(response)


def main(event, context):
    parameters = {}
    if 'Parameters' in event['ResourceProperties']:
        for parameter in event['ResourceProperties']['Parameters']:
            parameters[parameter['Key']] = parameter['Value']
    govcloud_account_id = parameters.get('govcloud_account_id')
    print(f'govcloud_account_id: {govcloud_account_id}')
    ssm_client = boto3.client('ssm')
    govcloud_access_key_id = ssm_client.get_parameter(
        Name='/compliant/framework/central-avm/aws-us-gov/access-key-id',
        WithDecryption=True
    )['Parameter']['Value']
    govcloud_secret_access_key = ssm_client.get_parameter(
        Name='/compliant/framework/central-avm/aws-us-gov/secret-access-key',
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
    invite_govcloud_account(sts_client_gc, org_client_gc,
                            govcloud_account_id, govcloud_region)


def lambda_handler(event, context):
    if event['RequestType'] == 'Create':
        try:
            main(event, context)
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
        except:
            print(sys.exc_info())
            cfnresponse.send(event, context, cfnresponse.FAILED, {})
    else:
        print("GovCloud accounts cannot be deleted or updated, but allowing the Product Action to succeed")
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
    return {}
