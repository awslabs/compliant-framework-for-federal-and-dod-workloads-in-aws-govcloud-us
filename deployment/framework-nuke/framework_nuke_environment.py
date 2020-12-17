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
parser.add_option('--transit-west-id', action='store', dest='transit_west_id')
parser.add_option('--transit-east-id', action='store', dest='transit_east_id')
parser.add_option('--management-west-id',
                  action='store', dest='management_west_id')
parser.add_option('--management-east-id',
                  action='store', dest='management_east_id')
parser.add_option('--stage',
                  action='store', dest='stage')
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
ssm_clients = {}
logs_clients = {}

cfn_clients['Transit'] = {}
ssm_clients['Transit'] = {}
logs_clients['Transit'] = {}
if (options.transit_west_id):
    cfn_clients['Transit']['West1'] = get_client(
        'cloudformation', options.transit_west_id)
    ssm_clients['Transit']['West1'] = get_client(
        'ssm', options.transit_west_id)
    logs_clients['Transit']['West1'] = get_client(
        'logs', options.transit_west_id)
if (options.transit_east_id):
    cfn_clients['Transit']['East1'] = get_client(
        'cloudformation', options.transit_east_id, region='us-gov-east-1')
    ssm_clients['Transit']['East1'] = get_client(
        'ssm', options.transit_east_id, region='us-gov-east-1')
    logs_clients['Transit']['East1'] = get_client(
        'logs', options.transit_east_id, region='us-gov-east-1')

cfn_clients['Management'] = {}
ssm_clients['Management'] = {}
logs_clients['Management'] = {}
if (options.management_west_id):
    cfn_clients['Management']['West1'] = get_client(
        'cloudformation', options.management_west_id)
    ssm_clients['Management']['West1'] = get_client(
        'ssm', options.management_west_id)
    logs_clients['Management']['West1'] = get_client(
        'logs', options.management_west_id)
if (options.management_east_id):
    cfn_clients['Management']['East1'] = get_client(
        'cloudformation', options.management_east_id, region='us-gov-east-1')
    ssm_clients['Management']['East1'] = get_client(
        'ssm', options.management_east_id, region='us-gov-east-1')
    logs_clients['Management']['East1'] = get_client(
        'logs', options.management_east_id, region='us-gov-east-1')

org_client = boto3.client('organizations')

delete_stack(cfn_clients['Central']['West1'], 'federation-stack')
delete_stack(cfn_clients['Logging']['West1'], 'federation-stack')

delete_stack_set(cfn_client=cfn_clients['Central']['West1'],
                 org_client=org_client,
                 stack_set_name='federation-stackset-us-gov-west-1',
                 ou_name='environment-usgw1',
                 region='us-gov-west-1')

delete_stack_set(cfn_client=cfn_clients['Central']['West1'],  # Stacksets are in west
                 org_client=org_client,
                 stack_set_name='federation-stackset-us-gov-east-1',
                 ou_name='environment-usge1',
                 region='us-gov-east-1')

delete_stack_set(cfn_client=cfn_clients['Central']['West1'],
                 org_client=org_client,
                 stack_set_name='backup-services-stackset-us-gov-west-1',
                 ou_name='environment-usgw1',
                 region='us-gov-west-1')

delete_stack_set(cfn_client=cfn_clients['Central']['West1'],  # Stacksets are in west
                 org_client=org_client,
                 stack_set_name='backup-services-stackset-us-gov-east-1',
                 ou_name='environment-usge1',
                 region='us-gov-east-1')

delete_stack_set(cfn_client=cfn_clients['Central']['West1'],
                 org_client=org_client,
                 stack_set_name='security-baseline-stackset-us-gov-west-1',
                 ou_name='environment-usgw1',
                 region='us-gov-west-1')

delete_stack_set(cfn_client=cfn_clients['Central']['West1'],  # Stacksets are in west
                 org_client=org_client,
                 stack_set_name='security-baseline-stackset-us-gov-east-1',
                 ou_name='environment-usge1',
                 region='us-gov-east-1')

if (options.transit_west_id):
    delete_stack(cfn_clients['Transit']['West1'], 'transit-gateway-routes')

if (options.transit_east_id):
    delete_stack(cfn_clients['Transit']['East1'], 'transit-gateway-routes')

if (options.management_west_id):
    delete_stack(cfn_clients['Management']['West1'],
                 'management-services-init')

if (options.management_east_id):
    delete_stack(cfn_clients['Management']['East1'],
                 'management-services-init')

if (options.transit_west_id):
    delete_stack(cfn_clients['Transit']['West1'], 'transit-init')

if (options.transit_east_id):
    delete_stack(cfn_clients['Transit']['East1'], 'transit-init')

if (options.management_west_id):
    s3 = get_resource('s3', options.management_west_id)

    delete_objects(
        s3, f'environment-assets-{options.management_west_id}-us-gov-west-1')
    delete_objects(
        s3, f'config-{options.management_west_id}-us-gov-west-1')
    delete_objects(
        s3, f'flow-logs-{options.management_west_id}-us-gov-west-1')
    delete_objects(
        s3, f'cloudtrail-{options.management_west_id}-us-gov-west-1')

    delete_stack(cfn_clients['Management']['West1'],
                 'management-services-logging')

if (options.management_east_id):
    s3 = get_resource('s3', options.management_east_id, region='us-gov-east-1')

    delete_objects(
        s3, f'environment-assets-{options.management_east_id}-us-gov-east-1')
    delete_objects(
        s3, f'config-{options.management_east_id}-us-gov-east-1')
    delete_objects(
        s3, f'flow-logs-{options.management_east_id}-us-gov-east-1')
    delete_objects(
        s3, f'cloudtrail-{options.management_east_id}-us-gov-east-1')

    delete_stack(cfn_clients['Management']['East1'],
                 'management-services-logging')

delete_stack(cfn_clients['Central']['West1'],
             'environment-pipeline-stack')

# delete pipeline bucket
sts_client = boto3.client('sts')
central_account_id = sts_client.get_caller_identity()['Account']
delete_bucket(boto3.resource('s3'),
              f'environment-pipeline-{central_account_id}-us-gov-west-1')

if (options.transit_west_id):
    delete_ssm_parameters(ssm_clients['Transit']['West1'])
    delete_log_groups(logs_clients['Transit']['West1'])
if (options.transit_east_id):
    delete_ssm_parameters(ssm_clients['Transit']['East1'])
    delete_log_groups(logs_clients['Transit']['East1'])
if (options.management_west_id):
    delete_ssm_parameters(ssm_clients['Management']['West1'])
    delete_log_groups(logs_clients['Management']['West1'])
if (options.management_east_id):
    delete_ssm_parameters(ssm_clients['Management']['East1'])
    delete_log_groups(logs_clients['Management']['East1'])
