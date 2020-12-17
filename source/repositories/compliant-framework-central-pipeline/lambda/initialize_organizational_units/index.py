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
import json


def create_organizational_unit(org_client, ou_name, root_id):
    ou_id = None

    # Check if OU already exists
    children = org_client.list_children(
        ParentId=root_id,
        ChildType='ORGANIZATIONAL_UNIT'
    )

    for child in children['Children']:
        organization_unit = org_client.describe_organizational_unit(
            OrganizationalUnitId=child['Id']
        )
        if ou_name == organization_unit['OrganizationalUnit']['Name']:
            ou_id = organization_unit['OrganizationalUnit']['Id']
            break

    # If None, we need to create the OU
    if ou_id is None:
        organization_unit = org_client.create_organizational_unit(
            ParentId=root_id,
            Name=ou_name,
        )
        ou_id = organization_unit['OrganizationalUnit']['Id']

    return ou_id


def move_account(org_client, account_id, source_id, destination_id):
    try:
        org_client.move_account(
            AccountId=account_id,
            SourceParentId=source_id,
            DestinationParentId=destination_id
        )
    except org_client.exceptions.AccountNotFoundException:
        pass


def create_policies():
    pass


def lambda_handler(event, context):
    cp_client = boto3.client('codepipeline')
    try:
        print(json.dumps(event))

        # Extract the Job ID
        job_id = event['CodePipeline.job']['id']

        # Extract the Job Data
        job_data = event['CodePipeline.job']['data']

        params = json.loads(
            job_data['actionConfiguration']['configuration']['UserParameters'])
        print(params)

        org_client = boto3.client('organizations')
        roots = org_client.list_roots()

        # Get the Root ID
        root_id = ''
        for root in roots['Roots']:
            root_id = root['Id']
            break
        print(f'root_id: {root_id}')

        # Environment organizational unit
        environment_ou_name = params['ouName']
        environment_ou_id = create_organizational_unit(
            org_client, environment_ou_name, root_id)
        print(f'environment_ou_name: {environment_ou_id}')

        # Tenant organizational unit
        tenant_ou_name = f"{params['ouName']}-tenants"
        tenant_ou_id = create_organizational_unit(
            org_client, tenant_ou_name, environment_ou_id)
        print(f'tenant_ou_id: {tenant_ou_id}')

        for core_account in params['coreAccounts']:
            move_account(org_client, core_account, root_id, environment_ou_id)

        for tenant_account in params['tenantAccounts']:
            move_account(org_client, tenant_account, root_id, tenant_ou_id)

        cp_client.put_job_success_result(jobId=job_id)

    except Exception as e:
        # If any other exceptions which we didn't expect are raised
        # then fail the job and log the exception message.
        print('Function failed due to exception.')
        print(e)
        cp_client.put_job_failure_result(
            jobId=job_id, failureDetails={
                'message': e,
                'type': 'JobFailed'
            }
        )
