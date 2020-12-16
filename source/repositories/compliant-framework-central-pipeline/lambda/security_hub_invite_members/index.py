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


def lambda_handler(event, context):
    # pylint: disable=E1101

    cp_client = boto3.client('codepipeline')
    try:
        print(json.dumps(event))

        # Extract the Job ID
        job_id = event['CodePipeline.job']['id']

        # Extract the Job Data
        job_data = event['CodePipeline.job']['data']

        params = json.loads(
            job_data['actionConfiguration']['configuration']['UserParameters'])

        print('params:')
        print(json.dumps(params))

        region = params['region']

        sh_client = boto3.client('securityhub', region_name=region)
        sts_client = boto3.client('sts')

        # Create list of accounts to invite
        accounts_to_invite = list()
        for account in params['accountIds']:
            accounts_to_invite.append(account)

        # Remove accounts already in the members list
        members_list = sh_client.list_members()
        for member in members_list['Members']:
            account_id = member['AccountId']
            if (account_id in accounts_to_invite):
                accounts_to_invite.remove(account_id)

        # Invite any accounts, not already invited
        if accounts_to_invite:
            account_details = list()
            for account in accounts_to_invite:
                account_details.append({'AccountId': account})

            # Create the members
            response = sh_client.create_members(AccountDetails=account_details)
            print('create_members')
            print(json.dumps(response, default=str))

            # Invite the new accounts
            response = sh_client.invite_members(AccountIds=accounts_to_invite)
            print('invite_members')
            print(json.dumps(response, default=str))

        # Accept oustanding invite
        members_list = sh_client.list_members()
        for member in members_list['Members']:
            if member['MemberStatus'] == 'Invited':
                account_id = member['AccountId']
                master_id = member['MasterId']

                print(f'Need to accept invite for {account_id}')

                # Assume Role
                partition = params['partition']
                role_arn = f'arn:{partition}:iam::{account_id}:'\
                    f'role/SecurityHubAccessRole'
                assumed_role = sts_client.assume_role(
                    RoleArn=role_arn,
                    RoleSessionName='CompliantFramework'
                )

                # Member Client
                member_sh_client = boto3.client(
                    'securityhub',
                    aws_access_key_id=assumed_role['Credentials']['AccessKeyId'],
                    aws_secret_access_key=assumed_role['Credentials']['SecretAccessKey'],
                    aws_session_token=assumed_role['Credentials']['SessionToken'],
                    region_name=region
                )

                # Look for the invitation to accept
                invitations_list = member_sh_client.list_invitations()
                for invite in invitations_list['Invitations']:
                    if master_id == invite['AccountId']:
                        invitation_id = invite['InvitationId']
                        member_sh_client.accept_invitation(
                            MasterId=master_id,
                            InvitationId=invitation_id
                        )
                        break

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
