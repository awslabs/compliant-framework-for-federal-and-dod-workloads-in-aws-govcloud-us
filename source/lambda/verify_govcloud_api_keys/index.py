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

SSM_GOVCLOUD_ACCOUNT_ID = '/compliant/framework/central/aws-us-gov/id'
SSM_GOVCLOUD_ACCESS_KEY_ID = '/compliant/framework/central/aws-us-gov/access-key-id'
SSM_GOVCLOUD_SECRET_ACCESS_KEY = '/compliant/framework/central/aws-us-gov/secret-access-key'


def lambda_handler(event, context):
    ssm_client = boto3.client('ssm')
    ssm_client.get_parameter(
        Name=SSM_GOVCLOUD_ACCOUNT_ID
    )
    ssm_client.get_parameter(
        Name=SSM_GOVCLOUD_ACCESS_KEY_ID
    )
    ssm_client.get_parameter(
        Name=SSM_GOVCLOUD_SECRET_ACCESS_KEY,
        WithDecryption=True
    )

    return {}
