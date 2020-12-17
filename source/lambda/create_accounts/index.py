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
import boto3


def create_govcloud_account(ssm_client, org_client, name, email, environment):

    response = org_client.list_accounts()
    print('list_accounts')
    print(response)
    for account in response['Accounts']:
        if account['Email'] == email:
            print('Account already created')
            return
    response = org_client.create_gov_cloud_account(
        Email=email,
        AccountName=f'{environment}-{name}',
        RoleName='CompliantFrameworkAccountAccessRole'
    )
    print('create_gov_cloud_account')
    print(response)

    create_state = response['CreateAccountStatus']['State']
    if create_state == 'IN_PROGRESS' or create_state == 'SUCCEEDED':

        create_account_request_id = response['CreateAccountStatus']['Id']

        for _i in range(10):
            response = org_client.describe_create_account_status(
                CreateAccountRequestId=create_account_request_id
            )
            print('describe_create_account_status')
            print(response)

            if response['CreateAccountStatus']['State'] == 'SUCCEEDED':

                ssm_client.put_parameter(
                    Name=f'/compliant/framework/accounts/{environment}/{name}/aws/id',
                    Value=response['CreateAccountStatus']['AccountId'],
                    Type='String',
                    Overwrite=True
                )
                ssm_client.put_parameter(
                    Name=f'/compliant/framework/accounts/{environment}/{name}/aws-us-gov/id',
                    Value=response['CreateAccountStatus']['GovCloudAccountId'],
                    Type='String',
                    Overwrite=True
                )
                break

            time.sleep(20)


def lambda_handler(event, context):
    ssm_client = boto3.client('ssm')
    org_client = boto3.client('organizations')

    create_govcloud_account(ssm_client,
                            org_client,
                            name='logging',
                            email=event['LoggingAccountEmail'],
                            environment='core')

    create_govcloud_account(ssm_client,
                            org_client,
                            name='management-services',
                            email=event['ManagementServicesAccountEmail'],
                            environment='prod')

    create_govcloud_account(ssm_client,
                            org_client,
                            name='transit',
                            email=event['TransitAccountEmail'],
                            environment='prod')

    return {}
