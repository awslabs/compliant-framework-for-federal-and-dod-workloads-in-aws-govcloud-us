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

    cp_client = boto3.client('codepipeline')
    codecommit_client = boto3.client('codecommit')

    try:
        print(event)

        # Extract the Job ID
        job_id = event['CodePipeline.job']['id']

        # Extract the Job Data
        job_data = event['CodePipeline.job']['data']

        params = json.loads(
            job_data['actionConfiguration']['configuration']['UserParameters'])
        print(params)

        # pylint: disable=E1101
        bucket = boto3.resource('s3').Bucket(params['bucketName'])

        for repository_name in params['repositoryNames']:
            bucket.objects.filter(Prefix=repository_name).delete()

            branch_name = params['branchName']

            # get blob_list
            args = {'repositoryName': repository_name,
                    'afterCommitSpecifier': branch_name}
            response = codecommit_client.get_differences(**args)
            blob_list = [difference['afterBlob']
                         for difference in response['differences']]
            while 'nextToken' in response:
                args['nextToken'] = response['nextToken']
                response = codecommit_client.get_differences(**args)
                blob_list += [difference['afterBlob']
                              for difference in response['differences']]

            # reads each file in the branch and uploads it to the s3 bucket
            for blob in blob_list:
                path = blob['path']
                content = (codecommit_client.get_blob(
                    repositoryName=repository_name, blobId=blob['blobId']))['content']
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
