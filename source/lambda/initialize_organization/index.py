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

import time
import os
import json
import boto3
from botocore.exceptions import ClientError

SSM_GOVCLOUD_ACCESS_KEY_ID = '/compliant/framework/central/aws-us-gov/access-key-id'
SSM_GOVCLOUD_SECRET_ACCESS_KEY = '/compliant/framework/central/aws-us-gov/secret-access-key'
SSM_ORGANIZATION_ID = '/compliant/framework/organization/id'

OU_GOVCLOUD_ACCOUNTS = 'govcloud-accounts'
OU_CORE_ACCOUNTS = 'core-accounts'


def get_parent_id(org_client):
    response = org_client.list_roots()
    for root in response['Roots']:
        root_id = root['Id']
        break
    return root_id


def organization_exists(org_client):
    try:
        org_client.describe_organization()
        return True
    except ClientError:
        pass
    return False


def initialize_organization(org_client, ou_name):

    if (not organization_exists(org_client)):
        org_client.create_organization(
            FeatureSet='ALL'
        )

    root_id = get_parent_id(org_client)
    response = org_client.list_organizational_units_for_parent(
        ParentId=root_id
    )

    has_ou = False
    for organizational_unit in response['OrganizationalUnits']:
        if organizational_unit['Name'] == ou_name:
            has_ou = True

    if (not has_ou):
        org_client.create_organizational_unit(
            ParentId=root_id,
            Name=ou_name
        )


def lambda_handler(event, context):
    ssm_client = boto3.client('ssm')

    govcloud_access_key_id = ssm_client.get_parameter(
        Name=SSM_GOVCLOUD_ACCESS_KEY_ID
    )['Parameter']['Value']
    govcloud_secret_access_key = ssm_client.get_parameter(
        Name=SSM_GOVCLOUD_SECRET_ACCESS_KEY,
        WithDecryption=True
    )['Parameter']['Value']
    govcloud_region = 'us-gov-west-1'

    org_client_std = boto3.client('organizations')
    org_client_gc = boto3.client('organizations',
                                 aws_access_key_id=govcloud_access_key_id,
                                 aws_secret_access_key=govcloud_secret_access_key,
                                 region_name=govcloud_region)

    print('Initialize Commercial Organization')
    initialize_organization(org_client_std, OU_GOVCLOUD_ACCOUNTS)

    print('Initialize GovCloud Organization')
    initialize_organization(org_client_gc, OU_CORE_ACCOUNTS)

    ssm_client_gc = boto3.client('ssm',
                                 aws_access_key_id=govcloud_access_key_id,
                                 aws_secret_access_key=govcloud_secret_access_key,
                                 region_name=govcloud_region)

    response = org_client_gc.describe_organization()
    organization_id = response['Organization']['Id']

    ssm_client_gc.put_parameter(
        Name=SSM_ORGANIZATION_ID,
        Value=organization_id,
        Type='String',
        Overwrite=True
    )

    return {}
