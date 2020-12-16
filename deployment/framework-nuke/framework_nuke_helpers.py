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
import time
import optparse
from botocore.exceptions import ClientError


def delete_stack(cfn_client, stack_name):
    try:
        cfn_client.describe_stacks(StackName=stack_name)
    except Exception:
        print(f'{stack_name} does not exist')
        return

    try:
        print(f'Deleting {stack_name}')

        response = cfn_client.delete_stack(StackName=stack_name)
        print(json.dumps(response, indent=2, default=str))

        waiter = cfn_client.get_waiter('stack_delete_complete')
        waiter.wait(StackName=stack_name,
                    WaiterConfig={'Delay': 30, 'MaxAttempts': 20})

    except ClientError as e:
        print(e)
        pass


def delete_stack_set(cfn_client, org_client, stack_set_name, ou_name, region):

    try:
        response = org_client.list_roots()
        for root in response['Roots']:
            root_id = root['Id']
            break

        response = org_client.list_organizational_units_for_parent(
            ParentId=root_id
        )

        ou_id = None
        for organizational_unit in response['OrganizationalUnits']:
            if organizational_unit['Name'] == ou_name:
                ou_id = organizational_unit['Id']

        if (ou_id is None):
            return

        response = cfn_client.delete_stack_instances(
            StackSetName=stack_set_name,
            DeploymentTargets={'OrganizationalUnitIds': [ou_id]},
            Regions=[region],
            RetainStacks=False,
        )

        print(f'Deleting {stack_set_name}')

        print(json.dumps(response, indent=2, default=str))
        operation_id = response['OperationId']

        while True:
            response = cfn_client.describe_stack_set_operation(
                StackSetName=stack_set_name,
                OperationId=operation_id
            )
            print(json.dumps(response, indent=2, default=str))
            if response['StackSetOperation']['Status'] == 'SUCCEEDED':
                break

            time.sleep(2)

        response = cfn_client.delete_stack_set(StackSetName=stack_set_name)
        print(json.dumps(response, indent=2, default=str))

    except cfn_client.exceptions.StackSetNotFoundException as e:
        print(f'{stack_set_name} does not exist')
        pass
    except ClientError as e:
        print(e)


def get_client(service, account_id, region='us-gov-west-1'):
    sts_client = boto3.client('sts')

    role_arn = f'arn:aws-us-gov:iam::{account_id}:role/CompliantFrameworkAccountAccessRole'
    assumed_role = sts_client.assume_role(
        RoleArn=role_arn,
        RoleSessionName='CompliantFramework'
    )
    return boto3.client(
        service,
        aws_access_key_id=assumed_role['Credentials']['AccessKeyId'],
        aws_secret_access_key=assumed_role['Credentials']['SecretAccessKey'],
        aws_session_token=assumed_role['Credentials']['SessionToken'],
        region_name=region
    )


def get_resource(resource, account_id, region='us-gov-west-1'):
    sts_client = boto3.client('sts')

    role_arn = f'arn:aws-us-gov:iam::{account_id}:role/CompliantFrameworkAccountAccessRole'
    assumed_role = sts_client.assume_role(
        RoleArn=role_arn,
        RoleSessionName='CompliantFramework'
    )
    return boto3.resource(
        resource,
        aws_access_key_id=assumed_role['Credentials']['AccessKeyId'],
        aws_secret_access_key=assumed_role['Credentials']['SecretAccessKey'],
        aws_session_token=assumed_role['Credentials']['SessionToken'],
        region_name=region
    )


def delete_objects(s3, bucket_name):
    try:
        print(f'Emptying bucket: {bucket_name}')
        bucket = s3.Bucket(bucket_name)
        bucket.object_versions.delete()
        bucket.objects.all().delete()
    except:
        pass


def delete_bucket(s3, bucket_name):
    try:
        delete_objects(s3, bucket_name)

        print(f'Deleting bucket: {bucket_name}')
        bucket = s3.Bucket(bucket_name)
        bucket.delete()
    except:
        pass


def delete_ssm_parameters(ssm_client):
    response = ssm_client.describe_parameters()
    while True:
        for param in response['Parameters']:
            print(f'Deleting {param["Name"]}')
            ssm_client.delete_parameter(
                Name=param['Name']
            )

        if ('NextToken' in response):
            next_token = response['NextToken']
            response = ssm_client.describe_parameters(
                NextToken=next_token
            )
        else:
            break


def delete_security_hub_members(sh_client):
    try:
        response = sh_client.list_members()
        members = []
        for member in response['Members']:
            members.append(member['AccountId'])

        if members:
            sh_client.delete_members(AccountIds=members)
    except:
        pass


def delete_log_groups(logs_client):
    try:
        response = logs_client.describe_log_groups()
        while True:
            for log in response['logGroups']:
                log_group_name = log['logGroupName']
                print(f'Deleting log group: {log_group_name}')
                logs_client.delete_log_group(logGroupName=log_group_name)

            if 'nextToken' in response:
                next_token = response['nextToken']
                response = logs_client.describe_log_groups(
                    nextToken=next_token)
            else:
                break
    except:
        pass
