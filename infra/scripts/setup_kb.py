"""
setup_kb.py - Idempotent AOSS + Bedrock KB provisioning.

Every operation is idempotent: if a resource already exists the script
skips creation and returns the existing ID. Outputs are written to
$GITHUB_OUTPUT for consumption by subsequent workflow steps.

Required env vars:
  AWS_REGION, AWS_ACCOUNT_ID, ENVIRONMENT, BUCKET_NAME
"""
import os, sys, time, json, boto3, requests
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

REGION      = os.environ["AWS_REGION"]
ACCOUNT     = os.environ["AWS_ACCOUNT_ID"]
ENVIRONMENT = os.environ.get("ENVIRONMENT", "dev")
BUCKET_NAME = os.environ["BUCKET_NAME"]

KB_NAME   = f"docuquery-{ENVIRONMENT}"
COLL_NAME = "docuquery-vectors"
INDEX_NAME = "docuquery-index"
DS_NAME   = "docuquery-s3-source"
ROLE_NAME = "docuquery-kb-role"

session = boto3.Session(region_name=REGION)
iam     = session.client("iam")
aoss    = session.client("opensearchserverless")
bedrock = session.client("bedrock-agent")


def gh_output(key, value):
    path = os.environ.get("GITHUB_OUTPUT", "")
    if path:
        with open(path, "a") as f:
            f.write(f"{key}={value}\n")
    print(f"OUTPUT {key}={value}")


def wait_for(fn, label, interval=20, max_attempts=30):
    for i in range(max_attempts):
        result = fn()
        if result:
            return result
        print(f"  [{i+1}/{max_attempts}] waiting for {label}...")
        time.sleep(interval)
    raise RuntimeError(f"Timed out waiting for {label}")


def ensure_kb_role():
    try:
        role = iam.get_role(RoleName=ROLE_NAME)["Role"]
        print(f"IAM role exists: {role['Arn']}")
        return role["Arn"]
    except iam.exceptions.NoSuchEntityException:
        pass

    print("Creating IAM role...")
    trust = {
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "bedrock.amazonaws.com"},
            "Action": "sts:AssumeRole",
            "Condition": {
                "StringEquals": {"aws:SourceAccount": ACCOUNT},
                "ArnLike": {"aws:SourceArn": f"arn:aws:bedrock:{REGION}:{ACCOUNT}:knowledge-base/*"}
            }
        }]
    }
    role = iam.create_role(RoleName=ROLE_NAME,
                           AssumeRolePolicyDocument=json.dumps(trust))["Role"]
    iam.put_role_policy(RoleName=ROLE_NAME, PolicyName="S3Access",
        PolicyDocument=json.dumps({"Version": "2012-10-17", "Statement": [{
            "Effect": "Allow", "Action": ["s3:GetObject", "s3:ListBucket"],
            "Resource": [f"arn:aws:s3:::{BUCKET_NAME}", f"arn:aws:s3:::{BUCKET_NAME}/*"]
        }]}))
    iam.put_role_policy(RoleName=ROLE_NAME, PolicyName="BedrockEmbedding",
        PolicyDocument=json.dumps({"Version": "2012-10-17", "Statement": [{
            "Effect": "Allow", "Action": "bedrock:InvokeModel",
            "Resource": f"arn:aws:bedrock:{REGION}::foundation-model/amazon.titan-embed-text-v2:0"
        }]}))
    print(f"IAM role created: {role['Arn']}")
    return role["Arn"]


def _active_collection():
    for c in aoss.list_collections().get("collectionSummaries", []):
        if c["name"] == COLL_NAME and c["status"] == "ACTIVE":
            return c["id"]
    return None


def ensure_collection():
    for c in aoss.list_collections().get("collectionSummaries", []):
        if c["name"] == COLL_NAME:
            print(f"AOSS collection exists: {c['id']} ({c['status']})")
            if c["status"] != "ACTIVE":
                return wait_for(_active_collection, "collection ACTIVE")
            return c["id"]

    for policy_name, policy_type, policy_body in [
        ("docuquery-enc", "encryption",
         json.dumps({"Rules": [{"ResourceType": "collection",
             "Resource": [f"collection/{COLL_NAME}"]}], "AWSOwnedKey": True})),
        ("docuquery-net", "network",
         json.dumps([{"Rules": [
             {"ResourceType": "collection", "Resource": [f"collection/{COLL_NAME}"]},
             {"ResourceType": "dashboard",  "Resource": [f"collection/{COLL_NAME}"]}
         ], "AllowFromPublic": True}])),
    ]:
        try:
            aoss.create_security_policy(name=policy_name, type=policy_type, policy=policy_body)
            print(f"Created {policy_type} policy: {policy_name}")
        except aoss.exceptions.ConflictException:
            print(f"Policy {policy_name} already exists")

    print("Creating AOSS collection...")
    aoss.create_collection(name=COLL_NAME, type="VECTORSEARCH")
    return wait_for(_active_collection, "collection ACTIVE")


def ensure_access_policy(coll_id, role_arn, caller_arn):
    policy_body = json.dumps([{
        "Rules": [
            {"ResourceType": "index", "Resource": [f"index/{COLL_NAME}/*"],
             "Permission": ["aoss:CreateIndex","aoss:DeleteIndex","aoss:UpdateIndex",
                            "aoss:DescribeIndex","aoss:ReadDocument","aoss:WriteDocument"]},
            {"ResourceType": "collection", "Resource": [f"collection/{COLL_NAME}"],
             "Permission": ["aoss:CreateCollectionItems","aoss:DeleteCollectionItems",
                            "aoss:UpdateCollectionItems","aoss:DescribeCollectionItems"]}
        ],
        "Principal": [role_arn, caller_arn]
    }])
    try:
        aoss.create_access_policy(name="docuquery-access", type="data", policy=policy_body)
        print("AOSS data access policy created")
    except aoss.exceptions.ConflictException:
        existing = aoss.get_access_policy(name="docuquery-access", type="data")
        version  = existing["accessPolicyDetail"]["policyVersion"]
        aoss.update_access_policy(name="docuquery-access", type="data",
                                  policy=policy_body, policyVersion=version)
        print("AOSS data access policy updated")

    iam.put_role_policy(RoleName=ROLE_NAME, PolicyName="AOSSAccess",
        PolicyDocument=json.dumps({"Version": "2012-10-17", "Statement": [{
            "Effect": "Allow", "Action": "aoss:APIAccessAll",
            "Resource": f"arn:aws:aoss:{REGION}:{ACCOUNT}:collection/{coll_id}"
        }]}))
    print("AOSSAccess policy attached to KB role")


def ensure_vector_index(coll_id):
    creds    = session.get_credentials().get_frozen_credentials()
    endpoint = f"https://{coll_id}.{REGION}.aoss.amazonaws.com"
    url      = f"{endpoint}/{INDEX_NAME}"

    check = AWSRequest(method="HEAD", url=url,
                       headers={"x-amz-content-sha256": "UNSIGNED-PAYLOAD"})
    SigV4Auth(creds, "aoss", REGION).add_auth(check)
    p = check.prepare()
    if requests.head(p.url, headers=dict(p.headers)).status_code == 200:
        print(f"Vector index '{INDEX_NAME}' already exists")
        return

    print(f"Creating vector index '{INDEX_NAME}'...")
    body = {
        "settings": {"index": {"knn": True}},
        "mappings": {"properties": {
            "embedding": {"type": "knn_vector", "dimension": 1024,
                          "method": {"name": "hnsw", "engine": "faiss", "space_type": "l2"}},
            "text":     {"type": "text"},
            "metadata": {"type": "text"}
        }}
    }
    put = AWSRequest(method="PUT", url=url, data=json.dumps(body),
                     headers={"Content-Type": "application/json",
                               "x-amz-content-sha256": "UNSIGNED-PAYLOAD"})
    SigV4Auth(creds, "aoss", REGION).add_auth(put)
    p = put.prepare()
    resp = requests.put(p.url, headers=dict(p.headers), data=json.dumps(body))
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Index creation failed {resp.status_code}: {resp.text}")
    print("Vector index created")


def ensure_knowledge_base(coll_id, role_arn):
    for kb in bedrock.list_knowledge_bases().get("knowledgeBaseSummaries", []):
        if kb["name"] == KB_NAME:
            print(f"Knowledge Base exists: {kb['knowledgeBaseId']}")
            return kb["knowledgeBaseId"]

    print("Creating Knowledge Base (10s IAM propagation delay)...")
    time.sleep(10)
    resp = bedrock.create_knowledge_base(
        name=KB_NAME, roleArn=role_arn,
        knowledgeBaseConfiguration={
            "type": "VECTOR",
            "vectorKnowledgeBaseConfiguration": {
                "embeddingModelArn": f"arn:aws:bedrock:{REGION}::foundation-model/amazon.titan-embed-text-v2:0",
                "embeddingModelConfiguration": {
                    "bedrockEmbeddingModelConfiguration": {"dimensions": 1024}
                }
            }
        },
        storageConfiguration={
            "type": "OPENSEARCH_SERVERLESS",
            "opensearchServerlessConfiguration": {
                "collectionArn": f"arn:aws:aoss:{REGION}:{ACCOUNT}:collection/{coll_id}",
                "vectorIndexName": INDEX_NAME,
                "fieldMapping": {"vectorField": "embedding", "textField": "text",
                                 "metadataField": "metadata"}
            }
        }
    )
    kb_id = resp["knowledgeBase"]["knowledgeBaseId"]
    print(f"Knowledge Base created: {kb_id}")
    return kb_id


def ensure_data_source(kb_id):
    for ds in bedrock.list_data_sources(knowledgeBaseId=kb_id).get("dataSourceSummaries", []):
        if ds["name"] == DS_NAME:
            print(f"Data source exists: {ds['dataSourceId']}")
            return ds["dataSourceId"]

    print("Creating S3 data source...")
    resp = bedrock.create_data_source(
        knowledgeBaseId=kb_id, name=DS_NAME,
        dataSourceConfiguration={
            "type": "S3",
            "s3Configuration": {"bucketArn": f"arn:aws:s3:::{BUCKET_NAME}"}
        },
        vectorIngestionConfiguration={
            "chunkingConfiguration": {
                "chunkingStrategy": "FIXED_SIZE",
                "fixedSizeChunkingConfiguration": {"maxTokens": 1000, "overlapPercentage": 20}
            }
        }
    )
    ds_id = resp["dataSource"]["dataSourceId"]
    print(f"Data source created: {ds_id}")
    return ds_id


if __name__ == "__main__":
    caller_arn = session.client("sts").get_caller_identity()["Arn"]
    print(f"Caller: {caller_arn}")

    role_arn = ensure_kb_role()
    coll_id  = ensure_collection()
    ensure_access_policy(coll_id, role_arn, caller_arn)
    ensure_vector_index(coll_id)
    kb_id    = ensure_knowledge_base(coll_id, role_arn)
    ds_id    = ensure_data_source(kb_id)

    gh_output("KB_ID",   kb_id)
    gh_output("COLL_ID", coll_id)
    gh_output("DS_ID",   ds_id)
    print("Setup complete.")
