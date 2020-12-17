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
from botocore.exceptions import ClientError


def ssm_get_parameter(name):
    """ Gets an SSM Parameter
    """
    ssm_client = boto3.client('ssm')
    response = ssm_client.get_parameter(
        Name=name
    )
    return response['Parameter']['Value']


def lambda_handler(event, context):
    # pylint: disable=E1101

    cp_client = boto3.client('codepipeline')
    try:
        print(json.dumps(event))

        # Extract the Job ID
        job_id = event['CodePipeline.job']['id']

        # Extract the Job Data
        job_data = event['CodePipeline.job']['data']

        params = json.loads(
            job_data['actionConfiguration']['configuration']['UserParameters'])
        print(json.dumps(params))

        outputVariables = {}

        # print(params['Name'])
        for item in params['Items']:
            value = ssm_get_parameter(item['Name'])
            outputVariables[item['OutputVariable']] = value

        print(json.dumps(outputVariables))

        cp_client.put_job_success_result(
            jobId=job_id, outputVariables=outputVariables)

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
