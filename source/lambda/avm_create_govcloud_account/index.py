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


def create_govcloud_account(org_client, account_name, email):
    response = org_client.list_accounts()
    print('list_accounts')
    print(response)
    for account in response['Accounts']:
        if account['Email'] == email:
            print('Account already created')
            raise Exception('Account already created')
    response = org_client.create_gov_cloud_account(
        Email=email,
        AccountName=account_name,
        RoleName='CompliantFrameworkAccountAccessRole'
    )
    print('create_gov_cloud_account')
    print(response)
    create_state = response['CreateAccountStatus']['State']
    if create_state in ('IN_PROGRESS', 'SUCCEEDED'):
        create_account_request_id = response['CreateAccountStatus']['Id']
        # Loop through till account is created and reporting success
        for _i in range(10):
            response = org_client.describe_create_account_status(
                CreateAccountRequestId=create_account_request_id
            )
            print('describe_create_account_status')
            print(response)
            # Account successfully created
            if response['CreateAccountStatus']['State'] == 'SUCCEEDED':
                govcloud_account_id = response['CreateAccountStatus']['GovCloudAccountId']
                commercial_account_id = response['CreateAccountStatus']['AccountId']
                print(f'govcloud_account_id: {govcloud_account_id}')
                print(
                    f'commercial_account_id: {commercial_account_id}')
                return govcloud_account_id, commercial_account_id
            if response['CreateAccountStatus']['State'] == 'FAILED':
                reason = response['CreateAccountStatus']['FailureReason']
                print(f'Failure Reason: {reason}')
                raise Exception('Account creation failed')
            time.sleep(30)
    raise Exception('Account not created. May need to adjust timers')


def main(event, context):

    parameters = {}
    if 'Parameters' in event['ResourceProperties']:
        for parameter in event['ResourceProperties']['Parameters']:
            parameters[parameter['Key']] = parameter['Value']
    account_name = parameters['account_name']
    email = parameters['email']
    print(f'account_name: {account_name}')
    print(f'email: {email}')
    org_client = boto3.client('organizations')
    govcloud_account_id, commercial_account_id = create_govcloud_account(
        org_client, account_name, email)
    return govcloud_account_id, commercial_account_id


def lambda_handler(event, context):

    if event['RequestType'] == 'Create':
        try:
            govcloud_account_id, commercial_account_id = main(
                event, context)
            responseData = {}
            responseData['govcloud_account_id'] = govcloud_account_id
            responseData['commercial_account_id'] = commercial_account_id
            cfnresponse.send(
                event, context, cfnresponse.SUCCESS, responseData)
        except:
            print(sys.exc_info())
            cfnresponse.send(event, context, cfnresponse.FAILED, {})
    else:
        print(
            "GovCloud accounts cannot be deleted or updated, but allowing the Product Action to succeed")
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
    return {}
