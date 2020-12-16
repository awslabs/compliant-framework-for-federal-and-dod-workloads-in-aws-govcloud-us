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

parser = optparse.OptionParser()
parser.add_option('--name', action='store', dest='name')
parser.add_option('--branch', action='store', dest='branch')
options, _remainder = parser.parse_args()

codecommit_client = boto3.client('codecommit')
response = codecommit_client.list_repositories()

repo_exists = False
for repository in response['repositories']:
    if repository['repositoryName'] == options.name:
        repo_exists = True

if (repo_exists):
    print(f'Repo {options.name} already exists, done.')
else:
    #
    # Create Repository
    #
    print('Create Repository')
    response = codecommit_client.create_repository(
        repositoryName=options.name,
    )
    print(json.dumps(response, indent=2, default=str))

    #
    # Create Initial Commit
    #
    print('Create Initial Commit')
    commit_files = []
    for root, directories, files in os.walk(options.name, topdown=False):
        for name in files:
            with open(os.path.join(root, name), 'r') as r:
                file_path = os.path.join(root, name)
                file_path = file_path[len(f'{options.name}/'):]
                commit_files.append({
                    'filePath': file_path,
                    'fileMode': 'NORMAL',
                    'fileContent': r.read()
                })

    response = codecommit_client.create_commit(
        repositoryName=options.name,
        branchName='mainline',
        authorName='Compliant Framework',
        email='compliant-framework-info@amazon.com',
        commitMessage='Initial Commit',
        putFiles=commit_files
    )
    print(json.dumps(response, indent=2, default=str))

    #
    # Create Branch
    #
    print(f'Create Branch {options.branch}')
    commit_id = response['commitId']
    response = codecommit_client.create_branch(
        repositoryName=options.name,
        branchName=options.branch,
        commitId=commit_id
    )
    print(json.dumps(response, indent=2, default=str))
