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
import json
import string
import secrets
import cfnresponse
import boto3
from botocore.exceptions import ClientError


def lambda_handler(event, context):
    print(json.dumps(event, indent=2))

    try:
        if event['RequestType'] == 'Create' or event['RequestType'] == 'Update':
            state_machine_arn = os.environ['STATE_MACHINE_ARN']

            response = {}

            sfn_client = boto3.client('stepfunctions')
            response = sfn_client.start_execution(
                stateMachineArn=state_machine_arn,
                input=json.dumps({})
            )
            print(response)

            if 'PhysicalResourceId' in event:  # Update
                physical_resource_id = event['PhysicalResourceId']
            else:  # Create
                physical_resource_id = ''.join(
                    secrets.choice(string.hexdigits) for i in range(12))
                physical_resource_id = 'custom-' + physical_resource_id.lower()

            cfnresponse.send(event, context, cfnresponse.SUCCESS, {},
                             physicalResourceId=physical_resource_id)

        elif event['RequestType'] == 'Delete':
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})

    except Exception as error:
        print(error)
        cfnresponse.send(event, context, cfnresponse.FAILED, {})
