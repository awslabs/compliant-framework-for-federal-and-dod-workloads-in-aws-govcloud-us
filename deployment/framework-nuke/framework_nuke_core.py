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

from framework_nuke_helpers import *

parser = optparse.OptionParser()
parser.add_option('--logging-id', action='store', dest='logging_id')

options, _remainder = parser.parse_args()

cfn_clients = {
    'Central': {
        'West1': boto3.client('cloudformation'),
        'East1': boto3.client('cloudformation', region_name='us-gov-east-1')
    },
    'Logging': {
        'West1': get_client('cloudformation', options.logging_id),
        'East1': get_client('cloudformation', options.logging_id, region='us-gov-east-1')
    }
}

sh_clients = {
    'Central': {
        'West1': boto3.client('securityhub'),
        'East1': boto3.client('securityhub', region_name='us-gov-east-1')
    }
}

ssm_clients = {
    'Central': {
        'West1': boto3.client('ssm'),
        'East1': boto3.client('ssm', region_name='us-gov-east-1')
    },
    'Logging': {
        'West1': get_client('ssm', options.logging_id),
        'East1': get_client('ssm', options.logging_id, region='us-gov-east-1')
    }
}


logs_clients = {
    'Central': {
        'West1': boto3.client('logs'),
        'East1': boto3.client('logs', region_name='us-gov-east-1')
    },
    'Logging': {
        'West1': get_client('logs', options.logging_id),
        'East1': get_client('logs', options.logging_id, region='us-gov-east-1')
    }
}

delete_security_hub_members(sh_clients['Central']['East1'])
delete_stack(cfn_clients['Central']['East1'], 'central-init')
delete_stack(cfn_clients['Logging']['East1'], 'logging-init')

delete_security_hub_members(sh_clients['Central']['West1'])
delete_stack(cfn_clients['Central']['West1'], 'central-init')

s3 = get_resource('s3', options.logging_id)

delete_objects(s3, f'config-{options.logging_id}-us-gov-west-1')
delete_objects(s3, f'flow-logs-{options.logging_id}-us-gov-west-1')
delete_objects(s3, f'cloudtrail-{options.logging_id}-us-gov-west-1')
delete_objects(s3, f'consolidated-logs-{options.logging_id}-us-gov-west-1')

delete_stack(cfn_clients['Logging']['West1'], 'logging-init')

delete_ssm_parameters(ssm_clients['Logging']['East1'])
delete_ssm_parameters(ssm_clients['Logging']['West1'])
delete_ssm_parameters(ssm_clients['Central']['East1'])
delete_ssm_parameters(ssm_clients['Central']['West1'])

# may need to add retries
delete_stack(cfn_clients['Central']['West1'],
             'core-pipeline-stack')

# delete pipeline bucket
sts_client = boto3.client('sts')
central_account_id = sts_client.get_caller_identity()['Account']
delete_bucket(boto3.resource('s3'),
              f'core-pipeline-{central_account_id}-us-gov-west-1')

delete_log_groups(logs_clients['Logging']['West1'])
delete_log_groups(logs_clients['Logging']['East1'])
delete_log_groups(ssm_clients['Central']['East1'])
delete_log_groups(ssm_clients['Central']['West1'])

logs_client = logs_clients['Logging']['East1']

response = logs_client.describe_log_groups()
while True:
    for log in response['logGroups']:
        log_group_name = log['logGroupName']
        print(f'Deleting log group: {log_group_name}')
        logs_client.delete_log_group(logGroupName=log_group_name)

    if 'nextToken' in response:
        next_token = response['nextToken']
        response = logs_client.describe_log_groups(nextToken='next_token')
    else:
        break
