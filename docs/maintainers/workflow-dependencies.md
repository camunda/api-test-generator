# What the Hub workflows depend on

Detail behind [the nightly guide](../hub-nightly-cookbook.md).

If one of these breaks, the matching alerts stop or fail. The owner and the rotation of each are to be named in the handover.

| Dependency | Used for | Where it is configured |
|---|---|---|
| GitHub App `preview-envs` (read) | Cloning the private camunda-hub repo | Vault, `secret/data/products/web-modeler/ci/preview-envs`, read by `.github/actions/hub-clone-token` |
| GitHub App `camunda/qa-processes` (write) | Opening and editing issues and comments | Vault, `secret/data/products/qa/ci/github.com/apps/camunda/qa-processes` |
| Vault login (JWT role and an approle) | Every workflow reads its secrets from Vault | Repo secrets `VAULT_ADDR`, `VAULT_JWT_PATH`, `VAULT_JWT_ROLE`, `VAULT_JWT_AUDIENCE`, `VAULT_ROLE_ID`, `VAULT_SECRET_ID` |
| Slack bot token | Every post in the Slack channels | Vault, `secret/data/products/qa/ci/common`, key `SLACK_BOT_USER_OAUTH_TOKEN`, read by `.github/actions/slack-token` |
| TestRail credentials | Publishing the nightly results | Vault, `secret/data/products/qa/ci/common` |
| Claude API key | The classifier on PRs and the nightly triage | Vault, `secret/data/products/qa/ci/common`, key `CLAUDE_API_KEY` (the workflows alias it to `ANTHROPIC_API_KEY`) |
| Container registry login | Pulling the PR's Hub image | Repo secrets `CAMUNDA_CONTAINER_REGISTRY_USER` and `_PASSWORD` |

