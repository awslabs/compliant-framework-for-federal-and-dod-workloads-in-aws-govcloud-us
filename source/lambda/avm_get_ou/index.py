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
import sys
import cfnresponse


def check_children(parent, name, client):
    paginator = client.get_paginator(
        'list_organizational_units_for_parent')
    iterator = paginator.paginate(ParentId=parent)
    for page in iterator:
        for ou in page['OrganizationalUnits']:
            if ou['Name'] == name:
                return ou['Id']
    return ''


def find_ou(parn_id, pathlist, client):
    ou_id = ''
    for ou in pathlist:
        parn_id = check_children(parn_id, ou, client)
        if parn_id == '':
            raise Exception('ou path does not exist')
    ou_id = parn_id
    return ou_id


def main(event, context):
    parameters = {}
    if 'Parameters' in event['ResourceProperties']:
        for parameter in event['ResourceProperties']['Parameters']:
            parameters[parameter['Key']] = parameter['Value']
    ssm_client = boto3.client('ssm')
    govcloud_access_key_id = ssm_client.get_parameter(
        Name='/compliant/framework/central-avm/aws-us-gov/access-key-id',
        WithDecryption=True
    )['Parameter']['Value']
    govcloud_secret_access_key = ssm_client.get_parameter(
        Name='/compliant/framework/central-avm/aws-us-gov/secret-access-key',
        WithDecryption=True
    )['Parameter']['Value']
    govcloud_region = 'us-gov-west-1'
    org_client_gc = boto3.client('organizations',
                                 aws_access_key_id=govcloud_access_key_id,
                                 aws_secret_access_key=govcloud_secret_access_key,
                                 region_name=govcloud_region)
    root_id = org_client_gc.list_roots()['Roots'][0]['Id']
    path = parameters.get('ou_path')
    pathlist = path.split('/')
    ou_id = find_ou(root_id, pathlist, org_client_gc)
    print("root_id: " + root_id + " ou_id: " + ou_id)
    return root_id, ou_id


def lambda_handler(event, context):
    if event['RequestType'] == 'Create':
        try:
            current_parent_id, new_ou_id = main(event, context)
            responseData = {}
            responseData['current_parent_id'] = current_parent_id
            responseData['new_ou_id'] = new_ou_id
            cfnresponse.send(
                event, context, cfnresponse.SUCCESS, responseData)
        except:
            print(sys.exc_info())
            cfnresponse.send(event, context, cfnresponse.FAILED, {})
    else:
        print(
            "GovCloud accounts cannot be deleted or updated, but allowing the Product Action to succeed")
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
    return {}
