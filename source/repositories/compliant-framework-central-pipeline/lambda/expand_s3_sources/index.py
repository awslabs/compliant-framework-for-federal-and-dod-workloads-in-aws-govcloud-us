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

import zipfile
import tempfile

from boto3.session import Session


def lambda_handler(event, context):

    cp_client = boto3.client('codepipeline')
    s3_client = boto3.client('s3')

    try:
        print(json.dumps(event))

        # Extract the Job ID
        job_id = event['CodePipeline.job']['id']

        # Extract the Job Data
        job_data = event['CodePipeline.job']['data']

        params = json.loads(
            job_data['actionConfiguration']['configuration']['UserParameters'])
        print(json.dumps(params))

        tmp_file = tempfile.NamedTemporaryFile()
        bucket_name = job_data['inputArtifacts'][0]['location']['s3Location']['bucketName']
        object_key = job_data['inputArtifacts'][0]['location']['s3Location']['objectKey']

        print(f'bucket_name {bucket_name}')

        print(f'object_key {object_key}')

        repository_name = params['repositoryName']

        bucket = boto3.resource('s3').Bucket(params['bucketName'])
        bucket.objects.filter(Prefix=f'{repository_name}/').delete()
        branch_name = params['branchName']

        with tempfile.NamedTemporaryFile() as tmp_file:
            s3_client.download_file(bucket_name, object_key, tmp_file.name)

            with zipfile.ZipFile(tmp_file.name) as zip:
                for path in zip.namelist():
                    content = zip.read(path)
                    if(len(content)):
                        # we have to guess the mime content-type of the files and
                        # provide it to S3 since S3 cannot do this on its own.
                        content_type = mimetypes.guess_type(path)[0]
                        if content_type is not None:
                            bucket.put_object(
                                Body=(content),
                                Key=f'{repository_name}/{path}',
                                ContentType=content_type,
                                ServerSideEncryption='aws:kms',
                                SSEKMSKeyId=params['kmsKeyId'])
                        else:
                            bucket.put_object(
                                Body=(content),
                                Key=f'{repository_name}/{path}',
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
