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
import mimetypes


def stack_set_exists(cf_client, stack_name):
    try:
        cf_client.describe_stack_set(StackSetName=stack_name)
        return True
    except cf_client.exceptions.StackSetNotFoundException:
        return False


def get_ou_id(org_client, ou_name):
    # Get the Root ID
    roots = org_client.list_roots()
    root_id = ''
    for root in roots['Roots']:
        root_id = root['Id']
        break
    print(f'root_id: {root_id}')

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
            return organization_unit['OrganizationalUnit']['Id']

    return None


def create_update_stackset(cf_client, stack_name, template_url, parameters, capabilities, tags, organization_unit_id, region):
    if not stack_set_exists(cf_client, stack_name):
        cf_client.create_stack_set(
            StackSetName=stack_name,
            TemplateURL=template_url,
            Parameters=parameters,
            Capabilities=capabilities,
            Tags=tags,
            PermissionModel='SERVICE_MANAGED',
            AutoDeployment={
                'Enabled': True,
                'RetainStacksOnAccountRemoval': True
            }
        )

        response = cf_client.create_stack_instances(
            StackSetName=stack_name,
            DeploymentTargets={
                'OrganizationalUnitIds': [organization_unit_id]
            },
            Regions=[region]
        )

        operation_id = response['OperationId']

    else:
        response = cf_client.update_stack_set(
            StackSetName=stack_name,
            TemplateURL=template_url,
            Parameters=parameters,
            Capabilities=capabilities,
            Tags=tags,
            PermissionModel='SERVICE_MANAGED',
            AutoDeployment={
                'Enabled': True,
                'RetainStacksOnAccountRemoval': True
            }
        )

        operation_id = response['OperationId']

    return operation_id


def lambda_handler(event, context):
    # pylint: disable=E1101

    cp_client = boto3.client('codepipeline')
    try:
        print(f'event:')
        print(json.dumps(event))

        # Extract the Job ID
        job_id = event['CodePipeline.job']['id']

        # Extract the Job Data
        job_data = event['CodePipeline.job']['data']

        cf_client = boto3.client('cloudformation')
        org_client = boto3.client('organizations')
        ssm_client = boto3.client('ssm')

        params = json.loads(
            job_data['actionConfiguration']['configuration']['UserParameters'])
        print(f'params:')
        print(json.dumps(params))

        if 'continuationToken' in job_data:
            continuation_token = json.loads(job_data['continuationToken'])
            operation_id = continuation_token['operationId']
            print(f'operation_id: {operation_id}')

            response = cf_client.describe_stack_set_operation(
                StackSetName=params['stackSetName'],
                OperationId=operation_id
            )
            print(f'describe_stack_set_operation:')
            print(json.dumps(response, default=str))

            status = response['StackSetOperation']['Status']

            # The status of the operation.
            #     FAILED : The operation exceeded the specified failure
            #       tolerance. The failure tolerance value that you've set for
            #       an operation is applied for each Region during stack create
            #       and update operations. If the number of failed stacks
            #       within a Region exceeds the failure tolerance, the status
            #       of the operation in the Region is set to FAILED . This in
            #       turn sets the status of the operation as a whole to FAILED,
            #       and AWS CloudFormation cancels the operation in any
            #       remaining Regions.
            #     QUEUED : [Service-managed permissions] For automatic
            #       deployments that require a sequence of operations, the
            #       operation is queued to be performed. For more information,
            #       see the stack set operation status codes in the AWS
            #       CloudFormation User Guide.
            #     RUNNING : The operation is currently being performed.
            #     STOPPED : The user has cancelled the operation.
            #     STOPPING : The operation is in the process of stopping, at
            #       user request.
            #     SUCCEEDED : The operation completed creating or updating all
            #      the specified stacks without exceeding the failure tolerance
            #      for the operation.

            if status == 'SUCCEEDED':
                cp_client.put_job_success_result(jobId=job_id)
            elif status == 'FAILED' or status == 'STOPPED':
                cp_client.put_job_failure_result(
                    jobId=job_id, failureDetails={
                        'message': f'Operation: {status}',
                        'type': 'JobFailed'
                    }
                )
            else:  # Still Running
                cp_client.put_job_success_result(
                    jobId=job_id,
                    continuationToken=json.dumps({'operationId': operation_id})
                )

        else:
            ou_id = get_ou_id(org_client, params['ouName'])

            parameter_dict = {}
            if 'parameters' in params:
                for key in params['parameters']:
                    parameter_dict[key] = params['parameters'][key]

            if 'ssmParameterPath' in params:
                ssm_params = json.loads(ssm_client.get_parameter(
                    Name=params['ssmParameterPath']
                )['Parameter']['Value'])

                for key in ssm_params:
                    if not key in parameter_dict:
                        parameter_dict[key] = ssm_params[key]

            stack_set_parameters = []
            for key in parameter_dict:
                value = parameter_dict[key]
                stack_set_parameters.append(
                    {
                        'ParameterKey': key,
                        'ParameterValue': value
                    }
                )

            operation_id = create_update_stackset(
                cf_client,
                params['stackSetName'],
                params['templateUrl'],
                stack_set_parameters,
                params['capabilities'],
                params['tags'],
                ou_id,
                params['region']
            )
            print(f'operation_id: {operation_id}')

            cp_client.put_job_success_result(
                jobId=job_id,
                continuationToken=json.dumps({'operationId': operation_id})
            )

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
