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


def lambda_handler(event, context):
    # pylint: disable=E1101

    cp_client = boto3.client('codepipeline')
    try:
        print(event)

        # Extract the Job ID
        job_id = event['CodePipeline.job']['id']

        # Extract the Job Data
        job_data = event['CodePipeline.job']['data']

        params = json.loads(
            job_data['actionConfiguration']['configuration']['UserParameters'])
        print(params)

        inputs = job_data['inputArtifacts']

        for input in inputs:
            print(input['location'])

            bucket_name = input['location']['s3Location']['bucketName']
            object_key = input['location']['s3Location']['objectKey']

            s3 = boto3.resource('s3')
            obj = s3.Object(bucket_name, object_key)
            body = obj.get()['Body'].read()

            # Re-write the object using this account to change the owner
            bucket = boto3.resource('s3').Bucket(bucket_name)
            bucket.put_object(
                Body=(body),
                Key=object_key,
                ServerSideEncryption='aws:kms',
                SSEKMSKeyId=params['kmsKeyId'])

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
