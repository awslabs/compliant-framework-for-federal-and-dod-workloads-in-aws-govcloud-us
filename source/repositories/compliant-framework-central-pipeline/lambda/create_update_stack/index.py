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

import os
import boto3
import json
import mimetypes


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

        ssm_client = boto3.client('ssm')

        params = json.loads(
            job_data['actionConfiguration']['configuration']['UserParameters'])
        print(f'params:')
        print(json.dumps(params))

        # Get the current account ID
        sts_client = boto3.client('sts')
        current_account_id = sts_client.get_caller_identity()['Account']
        print(f'current_account_id: {current_account_id}')

        # Get the partition
        if ('gov' in os.environ['AWS_REGION']):
            partition = 'aws-us-gov'
        else:
            partition = 'aws'
        print(f'partition: {partition}')

        account_id = params['account']
        region = params['region']
        if current_account_id == account_id:
            cfn_client = boto3.client('cloudformation',
                                      region_name=region)
        else:
            # Assume Role
            role_arn = f'arn:{partition}:iam::{account_id}:role/CompliantFrameworkAccountAccessRole'
            assumed_role = sts_client.assume_role(
                RoleArn=role_arn,
                RoleSessionName='CompliantFramework'
            )
            cfn_client = boto3.client(
                'cloudformation',
                aws_access_key_id=assumed_role['Credentials']['AccessKeyId'],
                aws_secret_access_key=assumed_role['Credentials']['SecretAccessKey'],
                aws_session_token=assumed_role['Credentials']['SessionToken'],
                region_name=region
            )

        if 'continuationToken' in job_data:
            continuation_token = json.loads(job_data['continuationToken'])
            stack_id = continuation_token['stack_id']
            print(f'stack_id: {stack_id}')

            stack_name = continuation_token['stack_name']
            print(f'stack_name: {stack_name}')

            response = cfn_client.describe_stacks(StackName=stack_name)
            print('describe_stacks:')
            print(json.dumps(response, default=str))

            for stack in response['Stacks']:
                if (stack['StackId'] == stack_id):
                    stack_status = stack['StackStatus']

                    # Succeeded - Done.
                    if stack_status in [
                            'CREATE_COMPLETE',
                            'UPDATE_COMPLETE']:

                        # Create Outputs here
                        outputVariables = {}
                        if ('Outputs' in stack):
                            for output in stack['Outputs']:
                                key = output['OutputKey']
                                value = output['OutputValue']
                                outputVariables[key] = value

                        cp_client.put_job_success_result(
                            jobId=job_id,
                            outputVariables=outputVariables
                        )
                    # Failed - Done.
                    elif stack_status in [
                            'UPDATE_ROLLBACK_COMPLETE',
                            'ROLLBACK_COMPLETE',
                            'CREATE_FAILED',
                            'ROLLBACK_FAILED',
                            'DELETE_FAILED',
                            'UPDATE_ROLLBACK_FAILED']:

                        cp_client.put_job_failure_result(
                            jobId=job_id,
                            failureDetails={
                                'message': f'Stack Status: {stack_status}',
                                'type': 'JobFailed'
                            }
                        )

                    # Still Running - Continue
                    else:
                        cp_client.put_job_success_result(
                            jobId=job_id,
                            continuationToken=json.dumps({
                                'stack_id': stack_id,
                                'stack_name': stack_name
                            })
                        )

        else:
            parameter_dict = {}
            if 'parameterOverrides' in params:
                for key in params['parameterOverrides']:
                    parameter_dict[key] = params['parameterOverrides'][key]
            if 'ssmParameterPath' in params:
                ssm_params = json.loads(ssm_client.get_parameter(
                    Name=params['ssmParameterPath']
                )['Parameter']['Value'])

                for key in ssm_params:
                    if not key in parameter_dict:
                        parameter_dict[key] = ssm_params[key]
            parameters = []
            for key in parameter_dict:
                value = parameter_dict[key]
                if isinstance(value, str):
                    parameters.append(
                        {
                            'ParameterKey': key,
                            'ParameterValue': value
                        }
                    )
                elif isinstance(value, dict):
                    parameters.append(
                        {
                            'ParameterKey': key,
                            'ParameterValue': json.dumps(value)
                        }
                    )
            print('parameters:')
            print(json.dumps(parameters, default=str))

            capabilities = []
            if 'capabilities' in params:
                capabilities.append(params['capabilities'])
            print('capabilities:')
            print(capabilities)

            bucket_domain = params['bucketRegionalDomainName']
            prefix = params['templatePrefix']
            path = params['templatePath']
            template_url = f'https://{bucket_domain}/{prefix}/{path}'
            print(f'template_url: {template_url}')

            stack_name = params['stackName']

            stack_exists = False
            try:
                # If the stack does not exist, an AmazonCloudFormationException
                # is returned.
                response = cfn_client.describe_stacks(StackName=stack_name)
                print(json.dumps(response, default=str))
                stack_exists = True

                for stack in response['Stacks']:
                    if (stack['StackName'] == stack_name):
                        stack_status = stack['StackStatus']

                        if stack_status == 'ROLLBACK_COMPLETE':
                            response = cfn_client.delete_stack(
                                StackName=stack_name
                            )
                            print('delete_stack response:')
                            print(json.dumps(response, default=str))
                            waiter = cfn_client.get_waiter(
                                'stack_delete_complete')
                            waiter.wait(StackName=stack_name, WaiterConfig={
                                        'Delay': 30, 'MaxAttempts': 20})
                            stack_exists = False
                        break
            except:
                pass

            if stack_exists:

                print('Stack exists - updating stack')
                response = cfn_client.update_stack(
                    StackName=stack_name,
                    TemplateURL=template_url,
                    Parameters=parameters,
                    Capabilities=capabilities
                )
            else:
                print('Stack does not exists - creating stack')
                response = cfn_client.create_stack(
                    StackName=stack_name,
                    TemplateURL=template_url,
                    Parameters=parameters,
                    Capabilities=capabilities
                )
                print(json.dumps(response, default='str'))

            stack_id = response['StackId']
            print(f'stack_id: {stack_id}')

            cp_client.put_job_success_result(
                jobId=job_id,
                continuationToken=json.dumps({
                    'stack_id': stack_id,
                    'stack_name': stack_name
                })
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
