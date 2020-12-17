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
import sys
import cfnresponse


def move_account(account_id, current_parent_id, new_ou_id, client):
    response = client.move_account(AccountId=account_id,
                                   SourceParentId=current_parent_id,
                                   DestinationParentId=new_ou_id)


def main(event, context):
    parameters = {}
    if 'Parameters' in event['ResourceProperties']:
        for parameter in event['ResourceProperties']['Parameters']:
            parameters[parameter['Key']] = parameter['Value']
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
    current_parent_id = parameters.get('current_parent_id')
    new_ou_id = parameters.get('new_ou_id')
    account_id = parameters.get('account_id')
    if current_parent_id == new_ou_id:
        print("New OU is root, no move needed")
        return
    else:
        move_account(account_id, current_parent_id,
                     new_ou_id, org_client_gc)
    return {}


def lambda_handler(event, context):
    if event['RequestType'] == 'Create':
        try:
            main(event, context)
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
        except:
            print(sys.exc_info())
            cfnresponse.send(event, context, cfnresponse.FAILED, {})
    else:
        print(
            "GovCloud accounts cannot be deleted or updated, but allowing the Product Action to succeed")
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
    return {}
