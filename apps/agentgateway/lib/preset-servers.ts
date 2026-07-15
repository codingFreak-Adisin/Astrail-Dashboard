import type { McpServer, McpTool } from "@/lib/types";

function codeFor(name: string, tools: McpTool[]) {
  const toolNames = tools.map((tool) => tool.name).join(", ");
  return `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: ${JSON.stringify(name)}, version: "1.0.0" });

// Curated Astrail template. Add the provider API token and replace the
// placeholder handlers with real fetch calls for: ${toolNames}.

server.tool("template_status", "Confirm this curated MCP template is installed.", z.object({}), async () => ({
  content: [{ type: "text", text: "Template installed. Add provider credentials to enable live API calls." }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
`;
}

function preset(id: string, name: string, category: string, description: string, tools: McpTool[]): McpServer {
  return {
    id,
    user_id: "preset",
    name,
    description,
    category,
    source_url: null,
    source_type: "preset",
    generated_code: codeFor(name, tools),
    tools_json: tools,
    endpoint_map: [],
    diagnostics: ["Curated Astrail preset template. Full provider execution requires user credentials."],
    status: "preset",
    validation_status: "passed",
    generation_status: "passed",
    is_public: true,
    hosted_endpoint: `/api/mcp/${id}`,
    call_count: 0,
    generation_version: "preset-v1",
    protocol_version: "2024-11-05",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

export const presetServers: McpServer[] = [
  preset("preset-github", "GitHub MCP Template", "Code", "Curated MCP template for repositories, issues, pull requests, and code search.", [
    { name: "github_search_repositories", description: "Search GitHub repositories by query, language, or owner.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "github_list_issues", description: "List issues for a repository with filters for state and labels.", input_schema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, state: { type: "string" } }, required: ["owner", "repo"] } },
    { name: "github_get_pull_request", description: "Fetch pull request metadata and review state for an agent workflow.", input_schema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, number: { type: "string" } }, required: ["owner", "repo", "number"] } },
  ]),
  preset("preset-linear", "Linear MCP Template", "Project management", "Curated MCP template for issues, projects, teams, and workflow updates.", [
    { name: "linear_search_issues", description: "Search Linear issues by text, assignee, team, or status.", input_schema: { type: "object", properties: { query: { type: "string" } } } },
    { name: "linear_create_issue", description: "Create a Linear issue with title, description, team, and priority.", input_schema: { type: "object", properties: { title: { type: "string" }, team_id: { type: "string" } }, required: ["title", "team_id"] } },
    { name: "linear_update_issue_status", description: "Move a Linear issue to a new workflow status.", input_schema: { type: "object", properties: { issue_id: { type: "string" }, status: { type: "string" } }, required: ["issue_id", "status"] } },
  ]),
  preset("preset-notion", "Notion MCP Template", "Knowledge", "Curated MCP template for pages, databases, blocks, and knowledge workflows.", [
    { name: "notion_search", description: "Search Notion pages and databases for agent-readable knowledge.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "notion_query_database", description: "Query a Notion database with simple filters and sorting.", input_schema: { type: "object", properties: { database_id: { type: "string" } }, required: ["database_id"] } },
    { name: "notion_create_page", description: "Create a Notion page in a database or parent page.", input_schema: { type: "object", properties: { parent_id: { type: "string" }, title: { type: "string" } }, required: ["parent_id", "title"] } },
  ]),
  preset("preset-slack", "Slack MCP Template", "Communication", "Curated MCP template for channels, messages, users, and team communication.", [
    { name: "slack_search_messages", description: "Search Slack messages across channels for a given query.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "slack_post_message", description: "Post a message to a Slack channel after user approval.", input_schema: { type: "object", properties: { channel_id: { type: "string" }, text: { type: "string" } }, required: ["channel_id", "text"] } },
    { name: "slack_list_channels", description: "List Slack channels visible to the connected workspace token.", input_schema: { type: "object", properties: {} } },
  ]),
  preset("preset-airtable", "Airtable MCP Template", "Database", "Curated MCP template for bases, tables, records, and lightweight internal tools.", [
    { name: "airtable_list_records", description: "List Airtable records from a base and table with optional filters.", input_schema: { type: "object", properties: { base_id: { type: "string" }, table_id: { type: "string" } }, required: ["base_id", "table_id"] } },
    { name: "airtable_create_record", description: "Create an Airtable record using structured fields.", input_schema: { type: "object", properties: { base_id: { type: "string" }, table_id: { type: "string" }, fields: { type: "object" } }, required: ["base_id", "table_id", "fields"] } },
    { name: "airtable_update_record", description: "Update fields on an existing Airtable record.", input_schema: { type: "object", properties: { record_id: { type: "string" }, fields: { type: "object" } }, required: ["record_id", "fields"] } },
  ]),
  preset("preset-stripe", "Stripe MCP Template", "Payments", "Curated MCP template for checkout, customers, invoices, subscriptions, and payment events.", [
    { name: "stripe_create_checkout_session", description: "Create a checkout session for a customer and price.", input_schema: { type: "object", properties: { customer_email: { type: "string" }, price_id: { type: "string" } }, required: ["price_id"] } },
    { name: "stripe_list_customers", description: "Search and list Stripe customers.", input_schema: { type: "object", properties: { email: { type: "string" } } } },
    { name: "stripe_get_invoice", description: "Fetch invoice status, amount, and hosted invoice URL.", input_schema: { type: "object", properties: { invoice_id: { type: "string" } }, required: ["invoice_id"] } },
  ]),
  preset("preset-hubspot", "HubSpot MCP Template", "CRM", "Curated MCP template for contacts, companies, deals, and sales workflows.", [
    { name: "hubspot_search_contacts", description: "Search HubSpot contacts by email, company, or lifecycle stage.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "hubspot_create_contact", description: "Create a HubSpot contact with structured fields.", input_schema: { type: "object", properties: { email: { type: "string" }, firstname: { type: "string" }, lastname: { type: "string" } }, required: ["email"] } },
    { name: "hubspot_update_deal_stage", description: "Move a deal to a new pipeline stage.", input_schema: { type: "object", properties: { deal_id: { type: "string" }, stage: { type: "string" } }, required: ["deal_id", "stage"] } },
  ]),
  preset("preset-jira", "Jira MCP Template", "Project management", "Curated MCP template for issues, projects, sprints, and engineering workflows.", [
    { name: "jira_search_issues", description: "Search Jira issues with JQL or text.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "jira_create_issue", description: "Create a Jira issue with project, summary, and description.", input_schema: { type: "object", properties: { project_key: { type: "string" }, summary: { type: "string" }, description: { type: "string" } }, required: ["project_key", "summary"] } },
    { name: "jira_transition_issue", description: "Move a Jira issue through a workflow transition.", input_schema: { type: "object", properties: { issue_key: { type: "string" }, transition: { type: "string" } }, required: ["issue_key", "transition"] } },
  ]),
  preset("preset-google-drive", "Google Drive MCP Template", "Knowledge", "Curated MCP template for files, folders, permissions, and document retrieval.", [
    { name: "drive_search_files", description: "Search Drive files by query, MIME type, or owner.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "drive_get_file", description: "Fetch file metadata and exportable content.", input_schema: { type: "object", properties: { file_id: { type: "string" } }, required: ["file_id"] } },
    { name: "drive_share_file", description: "Grant file access to a user or group.", input_schema: { type: "object", properties: { file_id: { type: "string" }, email: { type: "string" }, role: { type: "string" } }, required: ["file_id", "email"] } },
  ]),
  preset("preset-gmail", "Gmail MCP Template", "Communication", "Curated MCP template for inbox search, thread summaries, drafts, and email workflows.", [
    { name: "gmail_search_messages", description: "Search Gmail messages using Gmail query syntax.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "gmail_get_thread", description: "Fetch a Gmail thread with messages and participants.", input_schema: { type: "object", properties: { thread_id: { type: "string" } }, required: ["thread_id"] } },
    { name: "gmail_create_draft", description: "Create a draft reply for review before sending.", input_schema: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["to", "subject", "body"] } },
  ]),
  preset("preset-google-calendar", "Google Calendar MCP Template", "Communication", "Curated MCP template for events, availability, holds, and scheduling flows.", [
    { name: "calendar_list_events", description: "List calendar events for a date range.", input_schema: { type: "object", properties: { start: { type: "string" }, end: { type: "string" } }, required: ["start", "end"] } },
    { name: "calendar_find_availability", description: "Find free slots across calendars.", input_schema: { type: "object", properties: { attendees: { type: "array" }, duration_minutes: { type: "number" } }, required: ["duration_minutes"] } },
    { name: "calendar_create_event", description: "Create a calendar event with attendees and conferencing.", input_schema: { type: "object", properties: { title: { type: "string" }, start: { type: "string" }, end: { type: "string" } }, required: ["title", "start", "end"] } },
  ]),
  preset("preset-google-sheets", "Google Sheets MCP Template", "Database", "Curated MCP template for spreadsheet lookup, append, update, and reporting workflows.", [
    { name: "sheets_read_range", description: "Read values from a spreadsheet range.", input_schema: { type: "object", properties: { spreadsheet_id: { type: "string" }, range: { type: "string" } }, required: ["spreadsheet_id", "range"] } },
    { name: "sheets_append_row", description: "Append a row to a sheet.", input_schema: { type: "object", properties: { spreadsheet_id: { type: "string" }, range: { type: "string" }, values: { type: "array" } }, required: ["spreadsheet_id", "range", "values"] } },
    { name: "sheets_update_cells", description: "Update spreadsheet cells with structured values.", input_schema: { type: "object", properties: { spreadsheet_id: { type: "string" }, range: { type: "string" }, values: { type: "array" } }, required: ["spreadsheet_id", "range", "values"] } },
  ]),
  preset("preset-google-docs", "Google Docs MCP Template", "Knowledge", "Curated MCP template for reading, creating, and editing Google Docs.", [
    { name: "docs_get_document", description: "Fetch a Google Doc as structured text.", input_schema: { type: "object", properties: { document_id: { type: "string" } }, required: ["document_id"] } },
    { name: "docs_create_document", description: "Create a Google Doc with initial content.", input_schema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" } }, required: ["title"] } },
    { name: "docs_append_text", description: "Append reviewed text to a Google Doc.", input_schema: { type: "object", properties: { document_id: { type: "string" }, text: { type: "string" } }, required: ["document_id", "text"] } },
  ]),
  preset("preset-discord", "Discord MCP Template", "Communication", "Curated MCP template for servers, channels, messages, and community operations.", [
    { name: "discord_list_channels", description: "List channels in a Discord server.", input_schema: { type: "object", properties: { guild_id: { type: "string" } }, required: ["guild_id"] } },
    { name: "discord_send_message", description: "Send a message to a Discord channel after approval.", input_schema: { type: "object", properties: { channel_id: { type: "string" }, message: { type: "string" } }, required: ["channel_id", "message"] } },
    { name: "discord_search_messages", description: "Search indexed Discord messages.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  ]),
  preset("preset-figma", "Figma MCP Template", "Design", "Curated MCP template for files, nodes, comments, and design asset export.", [
    { name: "figma_get_file", description: "Fetch Figma file metadata and document tree.", input_schema: { type: "object", properties: { file_key: { type: "string" } }, required: ["file_key"] } },
    { name: "figma_export_assets", description: "Export selected nodes as SVG or PNG assets.", input_schema: { type: "object", properties: { file_key: { type: "string" }, node_ids: { type: "array" } }, required: ["file_key", "node_ids"] } },
    { name: "figma_create_comment", description: "Create a Figma comment on a file or node.", input_schema: { type: "object", properties: { file_key: { type: "string" }, message: { type: "string" } }, required: ["file_key", "message"] } },
  ]),
  preset("preset-shopify", "Shopify MCP Template", "Commerce", "Curated MCP template for products, orders, customers, inventory, and storefront operations.", [
    { name: "shopify_search_orders", description: "Search Shopify orders by customer, status, or date.", input_schema: { type: "object", properties: { query: { type: "string" } } } },
    { name: "shopify_update_inventory", description: "Update product inventory levels.", input_schema: { type: "object", properties: { inventory_item_id: { type: "string" }, quantity: { type: "number" } }, required: ["inventory_item_id", "quantity"] } },
    { name: "shopify_get_customer", description: "Fetch customer profile and order history.", input_schema: { type: "object", properties: { customer_id: { type: "string" } }, required: ["customer_id"] } },
  ]),
  preset("preset-zendesk", "Zendesk MCP Template", "Support", "Curated MCP template for tickets, users, macros, and support workflows.", [
    { name: "zendesk_search_tickets", description: "Search support tickets by status, requester, or text.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "zendesk_create_ticket", description: "Create a Zendesk support ticket.", input_schema: { type: "object", properties: { subject: { type: "string" }, body: { type: "string" }, requester_email: { type: "string" } }, required: ["subject", "body"] } },
    { name: "zendesk_update_ticket", description: "Update ticket status, assignee, or comment.", input_schema: { type: "object", properties: { ticket_id: { type: "string" }, status: { type: "string" }, comment: { type: "string" } }, required: ["ticket_id"] } },
  ]),
  preset("preset-intercom", "Intercom MCP Template", "Support", "Curated MCP template for conversations, contacts, notes, and customer support workflows.", [
    { name: "intercom_search_conversations", description: "Search Intercom conversations by text or contact.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "intercom_reply_conversation", description: "Draft or send a reply to an Intercom conversation.", input_schema: { type: "object", properties: { conversation_id: { type: "string" }, body: { type: "string" } }, required: ["conversation_id", "body"] } },
    { name: "intercom_get_contact", description: "Fetch Intercom contact profile and conversation history.", input_schema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
  ]),
  preset("preset-supabase", "Supabase MCP Template", "Database", "Curated MCP template for projects, tables, SQL, auth users, and edge functions.", [
    { name: "supabase_list_tables", description: "List tables and schema metadata for a project.", input_schema: { type: "object", properties: { project_ref: { type: "string" } }, required: ["project_ref"] } },
    { name: "supabase_run_sql", description: "Run reviewed SQL against a Supabase database.", input_schema: { type: "object", properties: { project_ref: { type: "string" }, sql: { type: "string" } }, required: ["project_ref", "sql"] } },
    { name: "supabase_list_auth_users", description: "List auth users with filters.", input_schema: { type: "object", properties: { project_ref: { type: "string" }, email: { type: "string" } }, required: ["project_ref"] } },
  ]),
  preset("preset-postgres", "Postgres MCP Template", "Database", "Curated MCP template for SQL querying, schema inspection, and database operations.", [
    { name: "postgres_describe_schema", description: "Inspect tables, columns, indexes, and relationships.", input_schema: { type: "object", properties: { schema: { type: "string" } } } },
    { name: "postgres_run_select", description: "Run a reviewed read-only SQL query.", input_schema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] } },
    { name: "postgres_explain_query", description: "Explain query plan and estimated cost.", input_schema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] } },
  ]),
  preset("preset-mongodb", "MongoDB MCP Template", "Database", "Curated MCP template for collections, documents, indexes, and aggregation pipelines.", [
    { name: "mongodb_list_collections", description: "List MongoDB collections in a database.", input_schema: { type: "object", properties: { database: { type: "string" } }, required: ["database"] } },
    { name: "mongodb_find_documents", description: "Find documents with a safe query filter.", input_schema: { type: "object", properties: { collection: { type: "string" }, filter: { type: "object" } }, required: ["collection"] } },
    { name: "mongodb_run_aggregate", description: "Run a reviewed aggregation pipeline.", input_schema: { type: "object", properties: { collection: { type: "string" }, pipeline: { type: "array" } }, required: ["collection", "pipeline"] } },
  ]),
  preset("preset-gitlab", "GitLab MCP Template", "Code", "Curated MCP template for projects, issues, merge requests, pipelines, and repositories.", [
    { name: "gitlab_search_projects", description: "Search GitLab projects visible to the token.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "gitlab_list_merge_requests", description: "List merge requests by project and state.", input_schema: { type: "object", properties: { project_id: { type: "string" }, state: { type: "string" } }, required: ["project_id"] } },
    { name: "gitlab_get_pipeline", description: "Fetch pipeline status and jobs.", input_schema: { type: "object", properties: { project_id: { type: "string" }, pipeline_id: { type: "string" } }, required: ["project_id", "pipeline_id"] } },
  ]),
  preset("preset-bitbucket", "Bitbucket MCP Template", "Code", "Curated MCP template for repositories, pull requests, branches, and CI status.", [
    { name: "bitbucket_list_repositories", description: "List repositories in a Bitbucket workspace.", input_schema: { type: "object", properties: { workspace: { type: "string" } }, required: ["workspace"] } },
    { name: "bitbucket_get_pull_request", description: "Fetch pull request metadata and diff links.", input_schema: { type: "object", properties: { workspace: { type: "string" }, repo_slug: { type: "string" }, pr_id: { type: "string" } }, required: ["workspace", "repo_slug", "pr_id"] } },
    { name: "bitbucket_list_pipelines", description: "List recent pipeline runs for a repository.", input_schema: { type: "object", properties: { workspace: { type: "string" }, repo_slug: { type: "string" } }, required: ["workspace", "repo_slug"] } },
  ]),
  preset("preset-vercel", "Vercel MCP Template", "DevOps", "Curated MCP template for projects, deployments, domains, and environment variables.", [
    { name: "vercel_list_projects", description: "List Vercel projects in a team.", input_schema: { type: "object", properties: { team_id: { type: "string" } } } },
    { name: "vercel_get_deployment", description: "Fetch deployment status, aliases, and logs.", input_schema: { type: "object", properties: { deployment_id: { type: "string" } }, required: ["deployment_id"] } },
    { name: "vercel_list_env_vars", description: "List project environment variable names without exposing secret values.", input_schema: { type: "object", properties: { project_id: { type: "string" } }, required: ["project_id"] } },
  ]),
  preset("preset-sentry", "Sentry MCP Template", "Observability", "Curated MCP template for issues, releases, alerts, traces, and error triage.", [
    { name: "sentry_search_issues", description: "Search Sentry issues by project, query, or status.", input_schema: { type: "object", properties: { organization: { type: "string" }, query: { type: "string" } }, required: ["organization"] } },
    { name: "sentry_get_issue", description: "Fetch issue details, stack trace, and events.", input_schema: { type: "object", properties: { issue_id: { type: "string" } }, required: ["issue_id"] } },
    { name: "sentry_resolve_issue", description: "Mark a Sentry issue as resolved after approval.", input_schema: { type: "object", properties: { issue_id: { type: "string" } }, required: ["issue_id"] } },
  ]),
  preset("preset-cloudflare", "Cloudflare MCP Template", "DevOps", "Curated MCP template for zones, DNS, workers, caches, and edge operations.", [
    { name: "cloudflare_list_zones", description: "List Cloudflare zones for an account.", input_schema: { type: "object", properties: { account_id: { type: "string" } }, required: ["account_id"] } },
    { name: "cloudflare_update_dns_record", description: "Update a DNS record with reviewed values.", input_schema: { type: "object", properties: { zone_id: { type: "string" }, record_id: { type: "string" }, value: { type: "string" } }, required: ["zone_id", "record_id", "value"] } },
    { name: "cloudflare_purge_cache", description: "Purge Cloudflare cache by URL or zone.", input_schema: { type: "object", properties: { zone_id: { type: "string" }, urls: { type: "array" } }, required: ["zone_id"] } },
  ]),
  preset("preset-docker", "Docker MCP Template", "DevOps", "Curated MCP template for containers, images, logs, and local runtime inspection.", [
    { name: "docker_list_containers", description: "List containers and current status.", input_schema: { type: "object", properties: { all: { type: "boolean" } } } },
    { name: "docker_get_logs", description: "Fetch recent logs for a container.", input_schema: { type: "object", properties: { container_id: { type: "string" }, lines: { type: "number" } }, required: ["container_id"] } },
    { name: "docker_restart_container", description: "Restart a container after approval.", input_schema: { type: "object", properties: { container_id: { type: "string" } }, required: ["container_id"] } },
  ]),
  preset("preset-kubernetes", "Kubernetes MCP Template", "DevOps", "Curated MCP template for pods, deployments, services, logs, and rollout checks.", [
    { name: "kubernetes_list_pods", description: "List pods by namespace and labels.", input_schema: { type: "object", properties: { namespace: { type: "string" }, selector: { type: "string" } } } },
    { name: "kubernetes_get_logs", description: "Fetch pod logs for troubleshooting.", input_schema: { type: "object", properties: { namespace: { type: "string" }, pod: { type: "string" } }, required: ["pod"] } },
    { name: "kubernetes_rollout_status", description: "Check rollout status for a deployment.", input_schema: { type: "object", properties: { namespace: { type: "string" }, deployment: { type: "string" } }, required: ["deployment"] } },
  ]),
  preset("preset-anthropic", "Anthropic MCP Template", "AI", "Curated MCP template for model calls, prompt testing, evals, and usage inspection.", [
    { name: "anthropic_create_message", description: "Call an Anthropic model with a reviewed prompt.", input_schema: { type: "object", properties: { model: { type: "string" }, prompt: { type: "string" } }, required: ["model", "prompt"] } },
    { name: "anthropic_run_eval", description: "Run a small prompt evaluation set.", input_schema: { type: "object", properties: { model: { type: "string" }, cases: { type: "array" } }, required: ["model", "cases"] } },
    { name: "anthropic_estimate_usage", description: "Estimate token usage for a prompt and context.", input_schema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] } },
  ]),
  preset("preset-mistral", "Mistral MCP Template", "AI", "Curated MCP template for model calls, embeddings, classifiers, and AI workflows.", [
    { name: "mistral_chat_completion", description: "Call a Mistral model with structured messages.", input_schema: { type: "object", properties: { model: { type: "string" }, messages: { type: "array" } }, required: ["model", "messages"] } },
    { name: "mistral_embed_text", description: "Generate embeddings for search or classification.", input_schema: { type: "object", properties: { input: { type: "array" } }, required: ["input"] } },
    { name: "mistral_classify_text", description: "Classify text into supplied labels.", input_schema: { type: "object", properties: { text: { type: "string" }, labels: { type: "array" } }, required: ["text", "labels"] } },
  ]),
  preset("preset-perplexity", "Perplexity MCP Template", "Research", "Curated MCP template for web research, answer generation, and citation-backed search.", [
    { name: "perplexity_search", description: "Search the web with concise citation-backed results.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "perplexity_answer", description: "Answer a research question with source links.", input_schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } },
    { name: "perplexity_compare_sources", description: "Compare multiple source claims for a topic.", input_schema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] } },
  ]),
  preset("preset-asana", "Asana MCP Template", "Project management", "Curated MCP template for tasks, projects, sections, and team planning.", [
    { name: "asana_search_tasks", description: "Search Asana tasks by project, assignee, or text.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "asana_create_task", description: "Create a task with assignee, due date, and project.", input_schema: { type: "object", properties: { name: { type: "string" }, project_id: { type: "string" }, assignee: { type: "string" } }, required: ["name"] } },
    { name: "asana_update_task", description: "Update task status, due date, or notes.", input_schema: { type: "object", properties: { task_id: { type: "string" }, completed: { type: "boolean" }, notes: { type: "string" } }, required: ["task_id"] } },
  ]),
  preset("preset-trello", "Trello MCP Template", "Project management", "Curated MCP template for boards, lists, cards, labels, and checklist workflows.", [
    { name: "trello_list_cards", description: "List Trello cards on a board or list.", input_schema: { type: "object", properties: { board_id: { type: "string" }, list_id: { type: "string" } } } },
    { name: "trello_create_card", description: "Create a Trello card with labels and due date.", input_schema: { type: "object", properties: { list_id: { type: "string" }, name: { type: "string" }, description: { type: "string" } }, required: ["list_id", "name"] } },
    { name: "trello_move_card", description: "Move a Trello card to another list.", input_schema: { type: "object", properties: { card_id: { type: "string" }, list_id: { type: "string" } }, required: ["card_id", "list_id"] } },
  ]),
  preset("preset-zoom", "Zoom MCP Template", "Communication", "Curated MCP template for meetings, recordings, participants, and scheduling workflows.", [
    { name: "zoom_list_meetings", description: "List upcoming Zoom meetings for a user.", input_schema: { type: "object", properties: { user_id: { type: "string" } } } },
    { name: "zoom_create_meeting", description: "Create a Zoom meeting with topic, time, and invitees.", input_schema: { type: "object", properties: { topic: { type: "string" }, start_time: { type: "string" } }, required: ["topic", "start_time"] } },
    { name: "zoom_get_recordings", description: "Fetch cloud recording metadata for a meeting.", input_schema: { type: "object", properties: { meeting_id: { type: "string" } }, required: ["meeting_id"] } },
  ]),
  preset("preset-dropbox", "Dropbox MCP Template", "Knowledge", "Curated MCP template for files, folders, sharing, and document retrieval.", [
    { name: "dropbox_search_files", description: "Search Dropbox files and folders.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "dropbox_get_file", description: "Fetch Dropbox file metadata and temporary link.", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    { name: "dropbox_create_shared_link", description: "Create a shared link after approval.", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  ]),
];

export function findPresetServer(id: string) {
  return presetServers.find((server) => server.id === id) ?? null;
}
