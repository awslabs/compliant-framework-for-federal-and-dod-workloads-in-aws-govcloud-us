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
import boto3
import optparse
import time

parser = optparse.OptionParser()
parser.add_option('--name', action='store', dest='name')
options, _remainder = parser.parse_args()

pipeline_client = boto3.client('codepipeline')

retries = 60  # One hour to allow pipline to build
while retries > 0:
    retries = retries-1

    response = pipeline_client.get_pipeline_state(
        name=options.name
    )
    # print(json.dumps(response, indent=2, default=str))

    pipeline_succeeded = True
    for stage_state in response['stageStates']:
        if stage_state['latestExecution']['status'] != 'Succeeded':
            pipeline_succeeded = False
            break  # ouf of for loop

    # Success - exit
    if pipeline_succeeded:
        print('Pipeline execution complete.')
        exit(0)  # Success!!

    # Try again after a minute
    print('Waiting for pipeline to finish...')
    time.sleep(60)

exit(1)  # Failure
