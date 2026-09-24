import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { unwrapList } from "../api/client";
import { getIntegrations, saveIntegration, toggleIntegration, syncGitHub, syncBitbucket, syncGitLab, sendTeamsTest } from "../api/integrations";
import { useNavigate } from "react-router-dom";
import client from "../api/client";
import PageHeader from "../components/PageHeader";
import InboundUrlPanel from "../components/InboundUrlPanel";
import { apiErrorMessage } from "../utils/apiError";

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATION CATALOGUE — 5 Tiers
// ═══════════════════════════════════════════════════════════════════════════
const TIERS = [
  {
    id: "identity", label: "Identity & Access", icon: "🔐",
    desc: "SSO, user provisioning, and enterprise authentication",
    color:"#5B5FEE", badge: "MUST-HAVE",
    integrations: [
      { key:"OKTA",       name:"Okta",              icon:"🔵", color:"#007DC1", tagline:"Enterprise SSO and lifecycle management",
        status:"available", effort:"oauth",
        fields:[
          {key:"domain",      label:"Okta Domain",    type:"text",    placeholder:"yourorg.okta.com",
           help:"Your Okta org URL — the part before .okta.com in your browser address bar"},
          {key:"clientId",    label:"Client ID",      type:"text",    placeholder:"0oa...",
           help:"Okta Admin → Applications → Create App Integration → OIDC → copy Client ID"},
          {key:"clientSecret",label:"Client Secret",  type:"password",placeholder:"Okta client secret",
           help:"Same application page → copy Client Secret value"},
        ],
        capabilities:["Single Sign-On (SAML 2.0)","Automatic user provisioning (SCIM)","Group-based access control","MFA enforcement"],
        docsUrl:"https://developer.okta.com/docs/guides/implement-oauth-for-okta/", docsLabel:"Okta Developer Docs →" },
      { key:"AZURE_AD",   name:"Microsoft Entra ID",icon:"🪟", color:"#0078D4", tagline:"Azure AD SSO + Microsoft 365 identity",
        status:"available", effort:"oauth",
        fields:[{key:"tenantId",label:"Tenant ID",type:"text",placeholder:"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"},{key:"clientId",label:"Application (Client) ID",type:"text",placeholder:"App registration client ID"},{key:"clientSecret",label:"Client Secret",type:"password",placeholder:"App registration secret"}],
        capabilities:["Azure AD Single Sign-On","Conditional access policies","Entra ID group sync","Microsoft 365 user directory"],
        docsUrl:"https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps", docsLabel:"Azure Portal →" },
      { key:"GOOGLE_WORKSPACE", name:"Google Workspace",icon:"🔴", color:"#4285F4", tagline:"Google OAuth and Workspace directory",
        status:"available", effort:"oauth",
        fields:[{key:"clientId",label:"Client ID",type:"text",placeholder:"xxx.apps.googleusercontent.com"},{key:"clientSecret",label:"Client Secret",type:"password",placeholder:"Google OAuth secret"},{key:"domain",label:"Workspace Domain",type:"text",placeholder:"yourcompany.com"}],
        capabilities:["Google OAuth 2.0 SSO","Workspace user directory sync","Google Drive integration","Calendar sync"],
        docsUrl:"https://console.cloud.google.com/apis/credentials", docsLabel:"Google Cloud Console →" },
      { key:"SAML",       name:"SAML 2.0",           icon:"🛡", color:"#334155", tagline:"Generic SAML 2.0 for any IdP",
        status:"available", effort:"config",
        fields:[{key:"idpMetadata",label:"IdP Metadata URL",type:"text",placeholder:"https://idp.company.com/saml/metadata"},{key:"entityId",label:"Service Provider Entity ID",type:"text",placeholder:"https://app.prowosma.com/saml"}],
        capabilities:["Standard SAML 2.0 SP","Works with Ping, ADFS, OneLogin","Attribute mapping","Just-in-time provisioning"],
        docsUrl:"https://docs.prowosma.com/saml", docsLabel:"Setup Guide →" },
      { key:"SCIM",       name:"SCIM 2.0",            icon:"👥", color:"#1E8E5A", tagline:"Automated user lifecycle management",
        status:"available", effort:"config",
        fields:[{key:"scimToken",label:"SCIM Bearer Token",type:"password",placeholder:"Auto-generated — click Generate"},{key:"scimEndpoint",label:"SCIM Endpoint",type:"text",placeholder:"Read-only — your SCIM URL"}],
        capabilities:["Auto-create users on hire","Auto-deactivate on departure","Role sync from IdP groups","Bulk user import"],
        docsUrl:"https://docs.prowosma.com/scim", docsLabel:"SCIM Docs →" },
    ],
  },
  {
    id: "devops", label: "Source Code & DevOps", icon: "⚙️",
    desc: "Connect your engineering workflow — PRs, builds, deployments, code quality",
    color: "#0ea5e9", badge: "ENGINEERING",
    integrations: [
      { key:"GITHUB",      name:"GitHub",       icon:"🐙", color:"#24292e", tagline:"PRs, issues, and CI status linked to tasks",
        status:"available", effort:"token",
        fields:[
          {key:"token",label:"Personal Access Token",type:"password",placeholder:"ghp_xxxx",
           help:"github.com → Settings → Developer settings → Personal access tokens → Generate new token (classic). Select: repo, read:org"},
          {key:"repo", label:"Repository",           type:"text",    placeholder:"owner/repo",
           help:"The repository you want to sync, e.g. acme-corp/backend"},
        ],
        capabilities:["Link PRs to tasks","Auto-close tasks on merge","CI/CD status in task cards","Commit activity timeline"],
        docsUrl:"https://github.com/settings/tokens", docsLabel:"Create Token →" },
      { key:"GITLAB",      name:"GitLab",       icon:"🦊", color:"#fc6d26", tagline:"Open issues and merge requests, synced as tasks",
        status:"available", effort:"token",
        fields:[
          {key:"token",label:"Access Token",type:"password",placeholder:"glpat-xxxx",
           help:"GitLab -> Preferences -> Access tokens. Scope: read_api. A project or group access token is best."},
          {key:"projectId",label:"Project ID or Path",type:"text",placeholder:"123 or group/project",
           help:"The numeric Project ID (shown on the project page) or the full path, e.g. acme/backend."},
          {key:"host",label:"GitLab URL (self-managed only)",type:"text",placeholder:"https://gitlab.com",
           help:"Leave blank for gitlab.com. A self-managed host must use https and be reachable from the Prowosma server."},
        ],
        capabilities:["Open issues become tasks","Open merge requests become tasks","Self-managed GitLab supported","Re-sync any time, no duplicates"],
        docsUrl:"https://gitlab.com/-/profile/personal_access_tokens", docsLabel:"Create Token ->" },
      { key:"BITBUCKET",   name:"Bitbucket",    icon:"🪣", color:"#0052CC", tagline:"Atlassian repos and pipelines",
        status:"available", effort:"oauth",
        fields:[{key:"workspaceSlug",label:"Workspace Slug",type:"text",placeholder:"my-workspace",
           help:"The part after bitbucket.org/ in your workspace URL"},
          {key:"repoSlug",label:"Repository Slug",type:"text",placeholder:"my-repo",
           help:"The repository to pull pull requests from"},
          {key:"username",label:"Bitbucket Username",type:"text",placeholder:"janedoe",
           help:"The account your app password belongs to — not your email"},
          {key:"appPassword",label:"App Password",type:"password",placeholder:"Bitbucket app password",
           help:"Bitbucket → Personal settings → App passwords → grant Repositories: Read + Pull requests: Read"}],
        capabilities:["PR to task linking","Pipeline triggers","Branch policies","Code review stats"],
        docsUrl:"https://support.atlassian.com/bitbucket-cloud/docs/app-passwords/", docsLabel:"App Passwords →" },
      { key:"AZURE_DEVOPS", name:"Azure DevOps", icon:"🔷", color:"#0078D4", tagline:"Work items, pipelines, and repos",
        status:"coming_soon", effort:"token",
        fields:[{key:"org",label:"Organisation",type:"text",placeholder:"dev.azure.com/yourorg"},{key:"pat",label:"Personal Access Token",type:"password",placeholder:"Azure DevOps PAT"},{key:"project",label:"Project",type:"text",placeholder:"My Project"}],
        capabilities:["Work item ↔ task sync","Build pipeline status","Release tracking","Board mirroring"],
        docsUrl:"https://dev.azure.com", docsLabel:"Azure DevOps →" },
      { key:"JENKINS",     name:"Jenkins",      icon:"🏗", color:"#d33833", tagline:"A failed build opens a task; the next good build closes it",
        status:"available", effort:"webhook", inbound:true,
        fields:[],
        capabilities:["Failed build opens a bug task","Next good build closes it","One task per failing job","Unstable builds at medium priority"],
        docsUrl:"https://plugins.jenkins.io/notification/", docsLabel:"Notification plugin ->" },
      { key:"CIRCLECI",    name:"CircleCI",     icon:"⭕", color:"#343434", tagline:"CI pipeline visibility",
        status:"coming_soon", effort:"token",
        fields:[{key:"token",label:"Personal API Token",type:"password",placeholder:"CircleCI token"},{key:"orgSlug",label:"Org Slug",type:"text",placeholder:"gh/YourOrg"}],
        capabilities:["Pipeline status","Workflow triggers","Test result summaries","Deployment tracking"],
        docsUrl:"https://circleci.com/docs/api-developers-guide/", docsLabel:"CircleCI API →" },
      { key:"SONARQUBE",   name:"SonarQube",    icon:"🔍", color:"#4E9BCD", tagline:"Code quality and security gates",
        status:"coming_soon", effort:"token",
        fields:[{key:"url",label:"SonarQube URL",type:"text",placeholder:"https://sonarqube.company.com"},{key:"token",label:"User Token",type:"password",placeholder:"squ_xxxx"},{key:"projectKey",label:"Project Key",type:"text",placeholder:"my-project"}],
        capabilities:["Quality gate in PR cards","Tech debt tracking","Security vulnerability tasks","Coverage trends"],
        docsUrl:"https://docs.sonarqube.org/latest/user-guide/user-account/generating-and-using-tokens/", docsLabel:"SonarQube Docs →" },
    ],
  },
  {
    id: "knowledge", label: "Docs & Knowledge", icon: "📚",
    desc: "Link tasks to documents, SOPs, PRDs, and meeting notes",
    color:"#7C5CBF", badge: "PRODUCTIVITY",
    integrations: [
      { key:"CONFLUENCE", name:"Confluence",    icon:"📘", color:"#0052CC", tagline:"Link tasks to Confluence pages and spaces",
        status:"coming_soon", effort:"oauth",
        fields:[
          {key:"baseUrl",   label:"Confluence URL", type:"text",     placeholder:"https://yourorg.atlassian.net/wiki",
           help:"Your Atlassian site URL — found in your browser address bar when logged into Confluence"},
          {key:"email",     label:"Atlassian Email",type:"text",     placeholder:"you@company.com",
           help:"The email address you used to sign up for Atlassian / Confluence"},
          {key:"apiToken",  label:"API Token",      type:"password", placeholder:"Paste your Atlassian API token here",
           help:"From id.atlassian.com → Security → API tokens → Create. Copy the token value (not the name)"},
        ],
        capabilities:["Attach Confluence pages to tasks","Create pages from task templates","Bi-directional linking","Space-level project mapping"],
        docsUrl:"https://id.atlassian.com/manage-profile/security/api-tokens", docsLabel:"Get API Token →" },
      { key:"NOTION",     name:"Notion",        icon:"🗒", color:"#000000", tagline:"Sync Notion databases with projects",
        status:"coming_soon", effort:"token",
        fields:[
          {key:"integrationToken",label:"Integration Token",type:"password",placeholder:"secret_xxxx",
           help:"Go to notion.so/my-integrations → New integration → copy the Internal Integration Secret"},
          {key:"databaseId",     label:"Database ID",      type:"text",    placeholder:"32-character ID from Notion URL",
           help:"Open the Notion database in your browser. The URL looks like notion.so/your-db-name-XXXXXXXX — copy the 32-char ID at the end"},
        ],
        capabilities:["Notion DB ↔ project sync","Page linking in tasks","Template-based doc creation","Knowledge base bridging"],
        docsUrl:"https://www.notion.so/my-integrations", docsLabel:"Create Integration →" },
      { key:"SHAREPOINT", name:"SharePoint",    icon:"📂", color:"#0078D4", tagline:"Microsoft 365 document management",
        status:"coming_soon", effort:"oauth",
        fields:[{key:"tenantId",label:"Tenant ID",type:"text",placeholder:"Azure tenant ID"},{key:"siteUrl",label:"SharePoint Site URL",type:"text",placeholder:"https://org.sharepoint.com/sites/projects"}],
        capabilities:["Attach SharePoint files to tasks","Document approval workflows","Version control sync","Teams-integrated notifications"],
        docsUrl:"https://docs.microsoft.com/en-us/sharepoint/dev/", docsLabel:"SharePoint Dev →" },
      { key:"GOOGLE_DRIVE", name:"Google Drive", icon:"📁", color:"#4285F4", tagline:"Attach Drive files directly to tasks",
        status:"available", effort:"oauth",
        fields:[{key:"clientId",label:"OAuth Client ID",type:"text",placeholder:"xxx.apps.googleusercontent.com"},{key:"clientSecret",label:"Client Secret",type:"password",placeholder:"Google OAuth secret"}],
        capabilities:["Attach Docs/Sheets/Slides to tasks","Create Drive folders per project","Comment sync","Shared drive support"],
        docsUrl:"https://console.cloud.google.com/apis/credentials", docsLabel:"Google Console →" },
      { key:"ONEDRIVE",   name:"OneDrive",      icon:"☁️", color:"#0078D4", tagline:"Microsoft file storage for project docs",
        status:"coming_soon", effort:"oauth",
        fields:[{key:"tenantId",label:"Tenant ID",type:"text",placeholder:"Azure tenant ID"},{key:"clientId",label:"Client ID",type:"text",placeholder:"Azure app client ID"}],
        capabilities:["File attachment from OneDrive","Real-time file collaboration","Folder per project","Office 365 preview"],
        docsUrl:"https://docs.microsoft.com/en-us/onedrive/developer/rest-api/", docsLabel:"OneDrive Dev →" },
    ],
  },
  {
    id: "crm_hr", label: "CRM & HR Systems", icon: "🏢",
    desc: "Auto-create projects from deals; sync headcount, onboarding, and capacity",
    color:"#C17D22", badge: "HIGH VALUE",
    integrations: [
      { key:"SALESFORCE",  name:"Salesforce",    icon:"☁️", color:"#00A1E0", tagline:"Deal closed → project created automatically",
        status:"coming_soon", effort:"oauth",
        fields:[
          {key:"instanceUrl",   label:"Salesforce URL",    type:"text",     placeholder:"https://yourorg.my.salesforce.com",
           help:"Your Salesforce org URL — visible in your browser when logged in"},
          {key:"clientId",      label:"Connected App Client ID",type:"text",placeholder:"3MVG9...",
           help:"Setup → App Manager → New Connected App → copy the Consumer Key"},
          {key:"clientSecret",  label:"Connected App Secret",  type:"password",placeholder:"Consumer Secret value",
           help:"Same Connected App → click Manage Consumer Details → copy Consumer Secret"},
        ],
        capabilities:["Opportunity → Project auto-creation","Account-level project portfolio","Revenue tracking per project","CRM contact linking in tasks"],
        docsUrl:"https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/", docsLabel:"Salesforce API →" },
      { key:"HUBSPOT",     name:"HubSpot",       icon:"🟠", color:"#FF7A59", tagline:"Pipeline deals trigger project workflow",
        status:"coming_soon", effort:"oauth",
        fields:[{key:"apiKey",label:"Private App Access Token",type:"password",placeholder:"pat-na1-xxxx"},{key:"portalId",label:"Portal ID",type:"text",placeholder:"Your HubSpot portal ID"}],
        capabilities:["Deal stage → project status sync","Contact tasks in HubSpot","Revenue attribution","Campaign project tracking"],
        docsUrl:"https://developers.hubspot.com/docs/api/overview", docsLabel:"HubSpot API →" },
      { key:"ZOHO_CRM",    name:"Zoho CRM",      icon:"🔶", color:"#E42527", tagline:"Zoho deal pipeline to project bridge",
        status:"coming_soon", effort:"oauth",
        fields:[{key:"clientId",label:"Client ID",type:"text",placeholder:"Zoho OAuth client ID"},{key:"clientSecret",label:"Client Secret",type:"password",placeholder:"Zoho OAuth secret"}],
        capabilities:["Lead → project creation","CRM module linking","Custom field mapping","Zoho Flow triggers"],
        docsUrl:"https://www.zoho.com/crm/developer/docs/api/v6/", docsLabel:"Zoho API →" },
      { key:"WORKDAY",     name:"Workday",       icon:"🟢", color:"#F5821F", tagline:"Employee onboarding, offboarding, and capacity",
        status:"coming_soon", effort:"config",
        fields:[{key:"tenantUrl",label:"Workday Tenant URL",type:"text",placeholder:"https://wd2-impl-services1.workday.com/ccx/..."},{key:"username",label:"Integration System User",type:"text",placeholder:"ISU username"},{key:"password",label:"Password",type:"password",placeholder:"ISU password"}],
        capabilities:["New hire → onboarding project","Offboarding workflow trigger","Resource allocation sync","Org chart for capacity planning"],
        docsUrl:"https://developer.workday.com/", docsLabel:"Workday Dev →" },
      { key:"BAMBOOHR",    name:"BambooHR",      icon:"🎋", color:"#73AC42", tagline:"HR events trigger project workflows",
        status:"coming_soon", effort:"token",
        fields:[{key:"subdomain",label:"BambooHR Subdomain",type:"text",placeholder:"yourcompany"},{key:"apiKey",label:"API Key",type:"password",placeholder:"BambooHR API key"}],
        capabilities:["Hire date → project creation","Team capacity from headcount","PTO impact on sprint planning","Role-based permission sync"],
        docsUrl:"https://documentation.bamboohr.com/reference/", docsLabel:"BambooHR API →" },
      { key:"SERVICENOW",  name:"ServiceNow",    icon:"🌐", color:"#81B5A1", tagline:"Incidents automatically become project work",
        status:"coming_soon", effort:"config",
        fields:[{key:"instanceUrl",label:"Instance URL",type:"text",placeholder:"https://yourorg.service-now.com"},{key:"username",label:"Username",type:"text",placeholder:"ServiceNow user"},{key:"password",label:"Password",type:"password",placeholder:"ServiceNow password"}],
        capabilities:["Incident → project auto-creation","Change request workflows","SLA tracking in tasks","Escalation rule engine"],
        docsUrl:"https://developer.servicenow.com/dev.do", docsLabel:"ServiceNow Dev →" },
    ],
  },
  {
    id: "financial", label: "Financial Systems", icon: "💰",
    desc: "Project budget, actual spend, resource cost, and profitability — in one place",
    color:"#1E8E5A", badge: "DIFFERENTIATOR",
    integrations: [
      { key:"QUICKBOOKS",  name:"QuickBooks",    icon:"💚", color:"#2CA01C", tagline:"Project budget vs actuals from QuickBooks",
        status:"coming_soon", effort:"oauth",
        fields:[{key:"clientId",label:"Client ID",type:"text",placeholder:"QuickBooks OAuth client ID"},{key:"clientSecret",label:"Client Secret",type:"password",placeholder:"QuickBooks OAuth secret"},{key:"realmId",label:"Company ID (Realm ID)",type:"text",placeholder:"Your QuickBooks company ID"}],
        capabilities:["Budget tracking per project","Invoice linkage","Expense categorisation","Margin and burn rate"],
        docsUrl:"https://developer.intuit.com/app/developer/qbo/docs/get-started", docsLabel:"QuickBooks Dev →" },
      { key:"XERO",        name:"Xero",          icon:"💙", color:"#13B5EA", tagline:"Xero invoices and budgets in project view",
        status:"coming_soon", effort:"oauth",
        fields:[{key:"clientId",label:"Client ID",type:"text",placeholder:"Xero OAuth client ID"},{key:"clientSecret",label:"Client Secret",type:"password",placeholder:"Xero OAuth secret"}],
        capabilities:["Real-time budget vs spend","Invoice → project tagging","Cost per resource","Forecasted margin"],
        docsUrl:"https://developer.xero.com/documentation/api/", docsLabel:"Xero API →" },
      { key:"SAP_ERP",     name:"SAP ERP",       icon:"🔷", color:"#0070F2", tagline:"Enterprise finance and resource management",
        status:"coming_soon", effort:"config",
        fields:[{key:"host",label:"SAP Host",type:"text",placeholder:"https://sap.company.com"},{key:"client",label:"SAP Client",type:"text",placeholder:"100"},{key:"username",label:"Username",type:"text",placeholder:"SAP username"},{key:"password",label:"Password",type:"password",placeholder:"SAP password"}],
        capabilities:["WBS element sync","Cost centre mapping","Project accounting","ERP budget import"],
        docsUrl:"https://api.sap.com/", docsLabel:"SAP API Hub →" },
      { key:"NETSUITE",    name:"Oracle NetSuite",icon:"🟠", color:"#F80000", tagline:"NetSuite project financials and resources",
        status:"coming_soon", effort:"config",
        fields:[{key:"accountId",label:"Account ID",type:"text",placeholder:"123456"},{key:"consumerKey",label:"Consumer Key",type:"text",placeholder:"TBA OAuth consumer key"},{key:"consumerSecret",label:"Consumer Secret",type:"password",placeholder:"TBA OAuth consumer secret"}],
        capabilities:["Revenue recognition per project","Resource cost tracking","Budget approval workflow","P&L per project"],
        docsUrl:"https://developers.netsuite.com/", docsLabel:"NetSuite Dev →" },
    ],
  },
  {
    id: "monitoring", label: "Monitoring & Operations", icon: "📡",
    desc: "Production incidents, alerts, and SLOs feed directly into project work",
    color:"#D64545", badge: "ENGINEERING",
    integrations: [
      { key:"DATADOG",    name:"Datadog",        icon:"🐶", color:"#632CA6", tagline:"Monitor alerts open tasks; recoveries close them",
        status:"available", effort:"webhook", inbound:true,
        fields:[],
        capabilities:["Alert opens an incident task","Repeat alerts do not duplicate","Recovery closes the task","Priority from the monitor's priority"],
        docsUrl:"https://docs.datadoghq.com/integrations/webhooks/", docsLabel:"Datadog Webhooks ->" },
      { key:"SENTRY",     name:"Sentry",         icon:"🔭", color:"#362D59", tagline:"New errors open bug tasks; resolving them closes the task",
        status:"available", effort:"webhook", inbound:true,
        fields:[
          {key:"clientSecret",label:"Client Secret (recommended)",type:"password",placeholder:"From your Sentry internal integration",
           help:"When set, events without a valid Sentry signature are rejected. Leave blank to rely on the secret URL alone."},
        ],
        capabilities:["New issue opens a bug task","Resolving in Sentry closes it","A regression reopens it","Issue alerts and metric alerts"],
        docsUrl:"https://docs.sentry.io/", docsLabel:"Sentry docs ->" },
      { key:"NEWRELIC",   name:"New Relic",      icon:"🟢", color:"#00838F", tagline:"APM alerts feed into project incidents",
        status:"coming_soon", effort:"token",
        fields:[{key:"apiKey",label:"User API Key",type:"password",placeholder:"NRAK-xxxx"},{key:"accountId",label:"Account ID",type:"text",placeholder:"New Relic account ID"}],
        capabilities:["APM alert → task creation","Deployment markers","Performance SLOs in goals","Error budget tracking"],
        docsUrl:"https://docs.newrelic.com/docs/apis/rest-api-v2/", docsLabel:"New Relic API →" },
      { key:"GRAFANA",    name:"Grafana",        icon:"📊", color:"#F46800", tagline:"Dashboard panels embedded in project views",
        status:"coming_soon", effort:"token",
        fields:[{key:"url",label:"Grafana URL",type:"text",placeholder:"https://grafana.company.com"},{key:"apiKey",label:"Service Account Token",type:"password",placeholder:"Grafana API token"}],
        capabilities:["Embed panels in project cards","Alert rule → task creation","SLO dashboards in goals","Oncall schedule sync"],
        docsUrl:"https://grafana.com/docs/grafana/latest/developers/http_api/", docsLabel:"Grafana API →" },
    ],
  },
  {
    id: "ai", label: "AI & LLM Providers", icon: "🤖",
    desc: "Power every AI feature with the model of your choice",
    color:"#5B5FEE", badge: "ALREADY BUILT",
    integrations: [
      { key:"ANTHROPIC",  name:"Anthropic Claude",icon:"🟣", color:"#6B3FA0", tagline:"Claude Sonnet and Opus for all AI features",
        status:"available", effort:"token",
        fields:[{key:"apiKey",label:"API Key",type:"password",placeholder:"sk-ant-xxxx"}],
        capabilities:["Task generation","Risk prediction","Sprint summaries","Meeting summaries","Executive reports"],
        docsUrl:"https://console.anthropic.com/settings/keys", docsLabel:"Get API Key →",
        settingsLink:"/ai-settings" },
      { key:"OPENAI",     name:"OpenAI GPT-4",    icon:"🟢", color:"#10A37F", tagline:"GPT-4o and GPT-4 Turbo for AI features",
        status:"available", effort:"token",
        fields:[{key:"apiKey",label:"API Key",type:"password",placeholder:"sk-xxxx"}],
        capabilities:["Natural language tasks","Code review summaries","Standup generation","Goal coaching","Risk detection"],
        docsUrl:"https://platform.openai.com/api-keys", docsLabel:"Get API Key →",
        settingsLink:"/ai-settings" },
      { key:"GEMINI",     name:"Google Gemini",   icon:"🔵", color:"#4285F4", tagline:"Gemini 1.5 Pro with free tier",
        status:"available", effort:"token",
        fields:[{key:"apiKey",label:"API Key",type:"password",placeholder:"AIzaSy-xxxx"}],
        capabilities:["Multimodal task input","Document summarisation","Project health analysis","OKR recommendations"],
        docsUrl:"https://aistudio.google.com/app/apikey", docsLabel:"Get API Key →",
        settingsLink:"/ai-settings" },
      { key:"MISTRAL",    name:"Mistral AI",      icon:"🌊", color:"#FF7000", tagline:"Open-weight models, EU data residency",
        status:"coming_soon", effort:"token",
        fields:[{key:"apiKey",label:"API Key",type:"password",placeholder:"Mistral API key"}],
        capabilities:["GDPR-compliant AI","French/European language support","On-prem deployment","Cost-efficient inference"],
        docsUrl:"https://docs.mistral.ai/", docsLabel:"Mistral Docs →" },
    ],
  },
  {
    id: "comms", label: "Communication", icon: "💬",
    desc: "Keep your team updated across every channel they already use",
    color: "#0ea5e9", badge: "COLLABORATION",
    integrations: [
      { key:"SLACK",      name:"Slack",           icon:"💬", color:"#4A154B", tagline:"Task updates, alerts, and standup reports to Slack",
        status:"available", effort:"webhook",
        fields:[
          {key:"webhookUrl",label:"Webhook URL",    type:"text",placeholder:"https://hooks.slack.com/services/T.../B.../...",
           help:"api.slack.com/apps → Create New App → Incoming Webhooks → Activate → Add New Webhook → copy URL"},
          {key:"channel",   label:"Default Channel",type:"text",placeholder:"#prowosma-updates",
           help:"The Slack channel to post updates to. Must match the channel selected when creating the webhook"},
        ],
        capabilities:["Task status notifications","Daily standup reports","Sprint completion alerts","Mention-based task creation"],
        docsUrl:"https://api.slack.com/messaging/webhooks", docsLabel:"Create Webhook →" },
      { key:"MICROSOFT_TEAMS", name:"Microsoft Teams",icon:"🟦", color:"#6264A7", tagline:"Project and task notifications in Teams channels",
        status:"available", effort:"webhook",
        fields:[{key:"webhookUrl",label:"Incoming Webhook URL",type:"text",placeholder:"https://outlook.office.com/webhook/..."},{key:"channel",label:"Channel (reference)",type:"text",placeholder:"#general"}],
        capabilities:["Channel notifications","Adaptive card summaries","Meeting task creation","Teams bot (coming soon)"],
        docsUrl:"https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook", docsLabel:"Setup Guide →" },
      { key:"ZOOM",       name:"Zoom",            icon:"📹", color:"#2D8CFF", tagline:"Meeting transcripts → tasks automatically",
        status:"available", effort:"oauth",
        fields:[{key:"accountId",label:"Account ID",type:"text",placeholder:"Zoom Account ID"},{key:"clientId",label:"Client ID",type:"text",placeholder:"Zoom OAuth client ID"},{key:"clientSecret",label:"Client Secret",type:"password",placeholder:"Zoom OAuth client secret"}],
        capabilities:["Meeting transcript → task extraction","Auto-schedule from tasks","Recording links in tasks","Meeting notes to docs"],
        docsUrl:"https://marketplace.zoom.us/develop/create", docsLabel:"Create Zoom App →" },
    ],
  },
];

const ALL_INTEGRATIONS = TIERS.flatMap(t => t.integrations.map(i => ({...i, tierId:t.id, tierLabel:t.label, tierColor:t.color})));

const EFFORT_LABELS = {
  oauth:   { label:"OAuth",   color:"#3b82f6", tip:"Connect with one click via OAuth" },
  token:   { label:"API Key", color:"#5B5FEE", tip:"Paste your API key to connect" },
  config:  { label:"Config",  color:"#7C5CBF", tip:"Manual configuration required" },
  webhook: { label:"Webhook", color:"#0ea5e9", tip:"Paste a webhook URL to connect" },
};

const STATUS_LABELS = {
  available:    { label:"Ready",       color:"#1E8E5A", bg:"#dcfce7", dot:"var(--success)" },
  coming_soon:  { label:"Config Only", color:"#5B5FEE", bg:"var(--brand-50)", dot:"var(--brand-500)" },
  connected:    { label:"Connected",   color:"#1E8E5A", bg:"#dcfce7", dot:"var(--success)" },
  error:        { label:"Error",       color:"#D64545", bg:"#fee2e2", dot:"var(--danger)" },
};

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATION CARD
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// SYNC ACTIONS — integrations with a real backend sync endpoint get a
// "Sync Now" button on their connected card. Not every integration needs
// one (some are link/attach-style, wired through IntegrationPanel.jsx
// instead) — this map only covers the pull-data-in ones.
// ═══════════════════════════════════════════════════════════════════════════
const SYNC_ACTIONS = {
  GITHUB:    { fn: syncGitHub,    label: "Sync Issues",  resultLabel: "issues" },
  BITBUCKET: { fn: syncBitbucket, label: "Sync PRs",      resultLabel: "pull requests" },
  GITLAB:    { fn: syncGitLab,    label: "Sync Issues & MRs", resultLabel: "issues and merge requests" },
  MICROSOFT_TEAMS: { fn: (id) => sendTeamsTest(id), label: "Send test", message: () => "Test message sent to Teams." },
};

function IntegrationCard({ intg, savedConfig, onConfigure, onToggle }) {
  const isConnected = !!(savedConfig?.enabled);
  const sl = STATUS_LABELS[isConnected ? "connected" : intg.status] || STATUS_LABELS.available;
  const ef = EFFORT_LABELS[intg.effort] || EFFORT_LABELS.token;
  const syncAction = SYNC_ACTIONS[intg.key];
  const [syncState, setSyncState] = useState(null); // null | "syncing" | { ok, message }

  const runSync = async (e) => {
    e.stopPropagation();
    if (!savedConfig?.id) {
      setSyncState({ ok: false, message: "Reconfigure this integration once to enable syncing." });
      return;
    }
    setSyncState("syncing");
    try {
      const res = await syncAction.fn(savedConfig.id);
      if (syncAction.message) {          // actions that send something rather than pull data in
        setSyncState({ ok: true, message: syncAction.message(res.data) });
        return;
      }
      const { imported = 0, total = 0, truncated = false } = res.data || {};
      const cut = truncated ? " Only the first 500 of each kind were read." : "";
      setSyncState({ ok: true,
        message: imported > 0
          ? `Imported ${imported} new ${syncAction.resultLabel} (${total} open).${cut}`
          : `Up to date: 0 new ${syncAction.resultLabel} (${total} open).${cut}` });
    } catch (err) {
      setSyncState({ ok: false, message: apiErrorMessage(err, err.message || "Sync failed.") });
    }
  };

  return (
    <div style={{
      background:"#fff",
      border:`1.5px solid ${isConnected ? intg.color+"55" : "var(--border)"}`,
      borderRadius:"14px",
      padding:"16px",
      display:"flex",
      flexDirection:"column",
      gap:"12px",
      boxShadow: "var(--elevation-1)",
      transition:"box-shadow .15s, border-color .15s",
    }}
    onMouseEnter={e => { if(!isConnected) { e.currentTarget.style.borderColor="var(--brand-200)"; e.currentTarget.style.boxShadow="0 4px 16px rgba(99,102,241,.08)"; }}}
    onMouseLeave={e => { if(!isConnected) { e.currentTarget.style.borderColor="var(--border)"; e.currentTarget.style.boxShadow="0 1px 3px rgba(0,0,0,.04)"; }}}>

      {/* ── Row 1: Icon + Name + Badges ── */}
      <div style={{ display:"flex", alignItems:"flex-start", gap:"10px" }}>
        <div style={{
          width:42, height:42, borderRadius:"10px", flexShrink:0,
          background:`${intg.color}14`, border:`1px solid ${intg.color}22`,
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:"20px",
        }}>{intg.icon}</div>

        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:800, fontSize:"13px", color:"#0f172a",
            marginBottom:"2px", display:"flex", alignItems:"center", gap:"5px", flexWrap:"wrap" }}>
            {intg.name}
            {isConnected && (
              <span style={{ fontSize:"9px", fontWeight:800, padding:"1px 6px",
                borderRadius:"999px", background:"#dcfce7", color:"#1E8E5A" }}>
                ✓ CONNECTED
              </span>
            )}
          </div>
          <div style={{ fontSize:"11px", color:"#64748b", lineHeight:1.4 }}>{intg.tagline}</div>
        </div>

        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end",
          gap:"3px", flexShrink:0 }}>
          <span style={{ fontSize:"9px", fontWeight:700, padding:"2px 7px",
            borderRadius:"999px", background:sl.bg, color:sl.color,
            display:"flex", alignItems:"center", gap:"3px" }}>
            <span style={{ width:5, height:5, borderRadius:"50%",
              background:sl.dot, display:"inline-block" }} />
            {sl.label}
          </span>
          <span style={{ fontSize:"9px", fontWeight:700, padding:"2px 7px",
            borderRadius:"999px", background:`${ef.color}15`, color:ef.color }}>
            {ef.label}
          </span>
        </div>
      </div>

      {/* ── Row 2: Capability chips ── */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:"4px" }}>
        {(intg.capabilities || []).slice(0, 3).map((cap, i) => (
          <span key={i} style={{ fontSize:"10px", padding:"2px 8px", borderRadius:"999px",
            background:"var(--gray-50)", border:"1px solid var(--border)", color:"#64748b" }}>
            {cap}
          </span>
        ))}
        {(intg.capabilities || []).length > 3 && (
          <span style={{ fontSize:"10px", color:"#94a3b8", padding:"2px 0" }}>
            +{intg.capabilities.length - 3} more
          </span>
        )}
      </div>

      {/* ── Row 3: Action buttons — always at bottom, always consistent ── */}
      <div style={{ display:"flex", gap:"6px", alignItems:"center", marginTop:"auto" }}>
        {intg.settingsLink ? (
          <a href={intg.settingsLink}
            style={{ flex:1, padding:"8px 14px", borderRadius:"8px",
              textAlign:"center", fontSize:"12px", fontWeight:700,
              background:intg.color,
              color:"#fff", textDecoration:"none", display:"block",
              boxSizing:"border-box" }}>
            ⚙️ Go to AI Settings
          </a>
        ) : (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onConfigure(intg); }}
              style={{ flex:1, padding:"8px 14px", borderRadius:"8px", border:"none",
                fontSize:"12px", fontWeight:700, cursor:"pointer",
                background: isConnected
                  ? "var(--gray-100)"
                  : intg.color,
                color: isConnected ? "var(--gray-700)" : "#fff",
                transition:"opacity .13s" }}
              onMouseEnter={e => e.currentTarget.style.opacity=".9"}
              onMouseLeave={e => e.currentTarget.style.opacity="1"}>
              {isConnected ? "⚙️ Reconfigure" : "🔗 Configure"}
            </button>

            {isConnected && syncAction && (
              <button
                type="button"
                onClick={runSync}
                disabled={syncState === "syncing"}
                title={syncAction.label}
                style={{ padding:"8px 12px", borderRadius:"8px", cursor: syncState === "syncing" ? "default" : "pointer",
                  border:`1px solid ${intg.color}33`, background:"#fff",
                  fontSize:"11px", fontWeight:700, color:intg.color, flexShrink:0,
                  opacity: syncState === "syncing" ? 0.6 : 1 }}>
                {syncState === "syncing" ? "⏳" : "🔄"} {syncAction.label}
              </button>
            )}

            {isConnected && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggle(intg.key); }}
                style={{ padding:"8px 12px", borderRadius:"8px", cursor:"pointer",
                  border:"1px solid #fee2e2", background:"#fff",
                  fontSize:"11px", fontWeight:700, color:"#D64545", flexShrink:0 }}>
                Disconnect
              </button>
            )}
          </>
        )}

        {intg.docsUrl && (
          <a href={intg.docsUrl} target="_blank" rel="noreferrer"
            title={intg.docsLabel || "Documentation"}
            onClick={e => e.stopPropagation()}
            style={{ padding:"8px 10px", borderRadius:"8px", border:"1px solid var(--border)",
              background:"#fff", fontSize:"13px", color:"#5B5FEE",
              textDecoration:"none", flexShrink:0, lineHeight:1 }}>
            📖
          </a>
        )}
      </div>

      {syncState && syncState !== "syncing" && (
        <div style={{ padding:"8px 10px", borderRadius:"8px", fontSize:"11px", fontWeight:600,
          background: syncState.ok ? "#f0fdf4" : "#fff1f2",
          border: `1px solid ${syncState.ok ? "#86efac" : "#fca5a5"}`,
          color: syncState.ok ? "#15803d" : "#b91c1c" }}>
          {syncState.ok ? "✓" : "⚠️"} {syncState.message}
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURE MODAL
// ═══════════════════════════════════════════════════════════════════════════
// Steps shown for integrations that RECEIVE events (Datadog, Sentry, Jenkins) instead of
// being given credentials.
const INBOUND_STEPS = [
  { n:1, title:"Save & Connect",
    body:"Read the tool's setup guide, then save this integration. No credentials are needed." },
  { n:2, title:"Generate your webhook URL",
    body:"Below, generate the URL that identifies your workspace. It is shown once." },
  { n:3, title:"Paste it into the tool",
    body:"Follow the setup steps under the URL, and events start creating tasks." },
];

function ConfigureModal({ intg, existing, onSave, onClose }) {
  const [form, setForm]       = useState(() => {
    const init = {};
    (intg.fields || []).forEach(f => { init[f.key] = existing?.config?.[f.key] || ""; });
    return init;
  });
  const [saving, setSaving]   = useState(false);
  const [saved,  setSaved]    = useState(false);
  const [error,  setError]    = useState(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // empty deps — listener registered once only

  const handleSave = async () => {
    setSaving(true); setError(null);
    try {
      await onSave(intg.key, form);
      setSaved(true);
      setTimeout(onClose, 900);
    } catch {
      setError("Failed to save. Please check your credentials and try again.");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <>
      {/* Dark overlay — rendered into document.body to escape backdrop-filter stacking context */}
      <div onClick={onClose}
        style={{ position:"fixed", top:0, left:0, width:"100vw", height:"100vh",
          background:"rgba(0,0,0,.55)", zIndex:99998 }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClose)?.(e); } }} />
      {/* Modal box — always centred in viewport regardless of scroll */}
      <div
        onClick={e => e.stopPropagation()}
        style={{ position:"fixed",
          top:"50%", left:"50%",
          transform:"translate(-50%, -50%)",
          width:"calc(100vw - 40px)", maxWidth:"520px",
          height:"auto", maxHeight:"88vh",
          overflow:"hidden",
          display:"flex", flexDirection:"column",
          background:"#fff", borderRadius:"18px",
          boxShadow:"var(--elevation-3)",
          zIndex:99999 }} role="presentation">

        {/* Header */}
        <div style={{ padding:"16px 20px", borderBottom:"1px solid var(--gray-100)",
          background:`${intg.color}0d`,
          display:"flex", alignItems:"center", gap:"14px",
          flexShrink:0, borderRadius:"18px 18px 0 0" }}>
          <div style={{ width:48, height:48, borderRadius:"12px", flexShrink:0,
            background:`${intg.color}18`, border:`1px solid ${intg.color}22`,
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:"24px" }}>
            {intg.icon}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:800, fontSize:"16px", color:"#0f172a" }}>
              Configure {intg.name}
            </div>
            <div style={{ fontSize:"12px", color:"#64748b", marginTop:"2px" }}>
              {intg.tagline}
            </div>
          </div>
          <button type="button" onClick={onClose}
            style={{ background:"none", border:"none", cursor:"pointer",
              fontSize:"20px", color:"#94a3b8", padding:"4px 8px",
              borderRadius:"6px", lineHeight:1 }}>
            ✕
          </button>
        </div>

        {/* Body — scrollable */}
        <div style={{ overflowY:"auto", flex:1, padding:"20px",
          display:"flex", flexDirection:"column", gap:"16px" }}>

          {/* 3-step guide */}
          <div style={{ background:"var(--gray-50)", borderRadius:"12px",
            border:"1px solid var(--border)", overflow:"hidden" }}>
            {(intg.inbound ? INBOUND_STEPS : [
              { n:1, title:"Get your credentials",
                body:"Visit the provider dashboard and generate an API key / access token." },
              { n:2, title:"Paste your credentials below",
                body:"Fill in each field — the label and hint explain exactly what to paste." },
              { n:3, title:"Click Save & Connect",
                body: intg.status==="coming_soon"
                  ? "Credentials saved securely. Live sync activates automatically once released."
                  : "Credentials are encrypted and stored securely on your server only." },
            ]).map((step, i) => (
              <div key={i} style={{ display:"flex", gap:"12px", padding:"10px 14px",
                borderBottom: i < 2 ? "1px solid var(--gray-100)" : "none" }}>
                <div style={{ width:22, height:22, borderRadius:"50%", flexShrink:0,
                  background:intg.color, color:"#fff", fontSize:"11px", fontWeight:800,
                  display:"flex", alignItems:"center", justifyContent:"center", marginTop:"1px" }}>
                  {step.n}
                </div>
                <div>
                  <div style={{ fontSize:"12px", fontWeight:700, color:"#1e293b",
                    marginBottom:"2px" }}>{step.title}</div>
                  <div style={{ fontSize:"11px", color:"#64748b", lineHeight:1.5 }}>
                    {i === 0 && intg.docsUrl
                      ? <>{step.body}{" "}<a href={intg.docsUrl} target="_blank"
                          rel="noreferrer" style={{ color:intg.color, fontWeight:700 }}>
                          {intg.docsLabel || "Open docs →"}
                        </a></>
                      : step.body}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Fields */}
          {(intg.fields || []).map(field => (
            <div key={field.key}>
              <label style={{ fontSize:"12px", fontWeight:700, color:"#334155",
                display:"block", marginBottom:"5px" }}>
                {field.label}
              </label>
              <input
                type={field.type || "text"}
                value={form[field.key] || ""}
                onChange={e => setForm(p => ({ ...p, [field.key]: e.target.value }))}
                placeholder={field.placeholder || ""}
                autoComplete="off"
                style={{ width:"100%", padding:"10px 12px", borderRadius:"8px",
                  border:"1.5px solid var(--border)", fontSize:"13px",
                  boxSizing:"border-box", outline:"none",
                  fontFamily: field.type==="password" ? "monospace" : "inherit" }}
                onFocus={e  => e.target.style.borderColor = intg.color}
                onBlur={e   => e.target.style.borderColor = "var(--border)"} />
              {field.help && (
                <div style={{ fontSize:"11px", color:"#64748b", marginTop:"4px",
                  lineHeight:1.5, padding:"4px 8px", background:"#fffbeb",
                  borderRadius:"6px", border:"1px solid #fef3c7" }}>
                  💡 {field.help}
                </div>
              )}
            </div>
          ))}

          {intg.inbound && (
            <InboundUrlPanel integrationKey={intg.key} savedId={existing?.id} color={intg.color} />
          )}

          {/* Capabilities unlock */}
          {(intg.capabilities||[]).length > 0 && (
            <div style={{ background:"#f0fdf4", borderRadius:"10px",
              border:"1px solid #bbf7d0", padding:"12px 14px" }}>
              <div style={{ fontSize:"11px", fontWeight:700, color:"#15803d",
                marginBottom:"8px", textTransform:"uppercase", letterSpacing:".05em" }}>
                What this unlocks
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px" }}>
                {intg.capabilities.map((cap,i) => (
                  <div key={i} style={{ fontSize:"11px", color:"#334155",
                    display:"flex", gap:"5px", alignItems:"flex-start" }}>
                    <span style={{ color:"#1E8E5A", fontWeight:700, flexShrink:0 }}>✓</span>
                    {cap}
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div style={{ padding:"10px 14px", borderRadius:"9px",
              background:"#fff1f2", border:"1px solid #fca5a5",
              fontSize:"12px", color:"#b91c1c", fontWeight:600 }}>
              ⚠️ {error}
            </div>
          )}

          {saved && (
            <div style={{ padding:"10px 14px", borderRadius:"9px",
              background:"#f0fdf4", border:"1px solid #86efac",
              fontSize:"12px", color:"#15803d", fontWeight:700 }}>
              ✓ Connected successfully!
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:"16px 20px", borderTop:"1px solid var(--gray-100)",
          display:"flex", gap:"8px", justifyContent:"flex-end", flexShrink:0 }}>
          <button type="button" onClick={onClose}
            style={{ padding:"10px 20px", borderRadius:"9px",
              border:"1px solid var(--border)", background:"#fff",
              fontSize:"13px", fontWeight:600, cursor:"pointer", color:"#334155" }}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving||saved}
            style={{ padding:"10px 28px", borderRadius:"9px", border:"none",
              background: saved
                ? "var(--success)"
                : intg.color,
              color:"#fff", fontSize:"13px", fontWeight:800, cursor:"pointer",
              opacity: (saving||saved) ? 0.85 : 1,
              boxShadow:"var(--elevation-2)",
              transition:"all .15s" }}>
            {saved ? "✓ Saved!" : saving ? "Saving…" : "💾 Save & Connect"}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED OPERATING LAYER VISUAL
// ═══════════════════════════════════════════════════════════════════════════
function UnifiedLayerBanner({ navigate }) {
  const steps = [
    { icon:"📹", label:"Meeting",    desc:"Zoom / Teams call", color:"#2D8CFF" },
    { icon:"🤖", label:"AI Extract", desc:"Decisions & actions", color:"#5B5FEE" },
    { icon:"✅", label:"Tasks",      desc:"Auto-created",      color:"#C17D22" },
    { icon:"📁", label:"Projects",   desc:"Sprint updated",    color:"#3b82f6" },
    { icon:"🎯", label:"Goals/OKRs", desc:"Progress tracked",  color:"#1E8E5A" },
    { icon:"💰", label:"Budgets",    desc:"Spend updated",     color:"#1E8E5A" },
    { icon:"📊", label:"Dashboard",  desc:"Exec view refreshed",color:"#7C5CBF" },
  ];
  return (
    <div style={{ background:"#0F1729",
      border:"1.5px solid rgba(99,102,241,.35)", borderRadius:"18px",
      padding:"24px 28px", marginBottom:"28px", position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:0, left:0, right:0, height:3,
        background:"var(--brand-500)" }} />

      <div style={{ display:"flex", alignItems:"flex-start", gap:"24px", flexWrap:"wrap" }}>
        <div style={{ flex:1, minWidth:240 }}>
          <div style={{ fontSize:"12px", fontWeight:700, color:"#38bdf8",
            letterSpacing:".06em", textTransform:"uppercase", marginBottom:"8px" }}>
            🔗 Enterprise Integration Vision
          </div>
          <div style={{ fontSize:"20px", fontWeight:800, color:"#fff",
            lineHeight:1.3, marginBottom:"8px" }}>
            Unified Operating Layer
          </div>
          <div style={{ fontSize:"13px", color:"#94a3b8", lineHeight:1.7, marginBottom:"16px" }}>
            No major product does this end-to-end. A Zoom meeting happens → AI extracts decisions
            → tasks auto-created → sprint updated → OKRs tracked → executive dashboard refreshed.
            All automatically.
          </div>
          <button onClick={()=>navigate("/bpm")}
            style={{ padding:"10px 22px", borderRadius:"10px", border:"none",
              background:"var(--brand-600)", color:"#fff",
              fontSize:"13px", fontWeight:800, cursor:"pointer",
              boxShadow:"var(--elevation-2)" }}>
            Build a Workflow →
          </button>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:0, flexWrap:"nowrap",
          overflowX:"auto", paddingBottom:"4px" }}>
          {steps.map((s,i) => (
            <div key={i} style={{ display:"flex", alignItems:"center" }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                gap:"6px", minWidth:70 }}>
                <div style={{ width:44, height:44, borderRadius:"12px",
                  background:`${s.color}22`, border:`1.5px solid ${s.color}44`,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:"20px" }}>{s.icon}</div>
                <div style={{ fontSize:"11px", fontWeight:700, color:"var(--border)",
                  textAlign:"center", lineHeight:1.2 }}>{s.label}</div>
                <div style={{ fontSize:"9px", color:"#64748b", textAlign:"center",
                  lineHeight:1.2 }}>{s.desc}</div>
              </div>
              {i < steps.length-1 && (
                <div style={{ width:24, height:2, background:"rgba(99,102,241,.4)",
                  margin:"0 2px", flexShrink:0, position:"relative", top:-16 }}>
                  <div style={{ position:"absolute", right:-4, top:-3,
                    borderLeft:"6px solid rgba(99,102,241,.6)",
                    borderTop:"4px solid transparent", borderBottom:"4px solid transparent" }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════
export default function Integrations() {
  const [savedConfigs,    setSavedConfigs]    = useState({});
  const [configuringIntg, setConfiguringIntg] = useState(null);
  const [activeTier,      setActiveTier]      = useState("all");
  const [search,          setSearch]          = useState("");

  const navigate = useNavigate();

  useEffect(() => {
    getIntegrations()
      .then(res => {
        const list = unwrapList(res);
        const map  = {};
        list.forEach(i => { map[i.key] = i; });
        setSavedConfigs(map);
      })
      .catch(() => {});
  }, []);

  const handleSave = async (key, config) => {
    const payload = { key, type:key, name:key, enabled:true, config };
    // Always force-update: delete old record and save fresh — guarantees no stale config
    let saved;
    try {
      saved = (await client.post(`/integrations/${key}/force-update`, payload)).data;
    } catch {
      // Fallback to regular save if force-update fails
      saved = (await saveIntegration(payload)).data;
    }
    // Capture the backend-assigned id from the response — without this, a
    // freshly-connected integration (no prior savedConfigs[key] entry) has
    // no `.id` in local state until the next page load, which silently
    // breaks any action that needs it (e.g. "Sync Now") right after connecting.
    setSavedConfigs(prev => ({ ...prev, [key]: saved || { ...prev[key], key, type:key, enabled:true, config } }));
  };

  const handleToggle = async (key) => {
    const current = savedConfigs[key];
    const next = { ...current, enabled:!current?.enabled };
    await toggleIntegration(key, next.enabled);
    setSavedConfigs(prev => ({ ...prev, [key]:next }));
  };

  // Filter
  const filtered = ALL_INTEGRATIONS.filter(i => {
    if (activeTier !== "all" && i.tierId !== activeTier) return false;
    if (search && !i.name.toLowerCase().includes(search.toLowerCase()) &&
        !i.tagline.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const connectedCount  = Object.values(savedConfigs).filter(c=>c?.enabled).length;
  const availableCount  = ALL_INTEGRATIONS.filter(i=>i.status==="available").length;
  const comingSoonCount = ALL_INTEGRATIONS.filter(i=>i.status==="coming_soon").length;

  return (
    <div>
      <PageHeader icon="🔌" title="Integrations"
        description="Connect Prowosma to your entire organisation's tech stack — from SSO and CRM to ERP and monitoring" />

      {/* Unified Layer Banner */}
      <UnifiedLayerBanner navigate={navigate} />

      {/* Stats */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"10px",
        marginBottom:"20px" }}>
        {[
          { label:"Connected",    value:connectedCount,     color:"#1E8E5A", icon:"✓" },
          { label:"Available",    value:availableCount,     color:"#5B5FEE", icon:"🔌" },
          { label:"Coming Soon",  value:comingSoonCount,    color:"#C17D22", icon:"🚀" },
          { label:"Total",        value:ALL_INTEGRATIONS.length, color:"#0ea5e9", icon:"📦" },
        ].map(s => (
          <div key={s.label} style={{ background:"var(--surface-1)", border:`1.5px solid ${s.color}22`,
            borderRadius:"12px", padding:"12px 14px", display:"flex", alignItems:"center",
            gap:"10px", boxShadow:"var(--elevation-1)" }}>
            <div style={{ width:36, height:36, borderRadius:"9px", background:`${s.color}18`,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:"16px", flexShrink:0 }}>{s.icon}</div>
            <div>
              <div style={{ fontSize:"20px", fontWeight:800, color:s.color, lineHeight:1 }}>{s.value}</div>
              <div style={{ fontSize:"11px", color:"#64748b", fontWeight:600 }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display:"flex", gap:"8px", marginBottom:"20px", alignItems:"center", flexWrap:"wrap" }}>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search integrations…"
          style={{ padding:"8px 14px", borderRadius:"10px", border:"1.5px solid var(--border)",
            fontSize:"13px", width:220, outline:"none" }}
          onFocus={e=>e.target.style.borderColor="var(--brand-500)"}
          onBlur={e=>e.target.style.borderColor="var(--border)"} />
        <div style={{ display:"flex", gap:"4px", flexWrap:"wrap" }}>
          {[{id:"all",label:"All"},
            ...TIERS.map(t=>({id:t.id,label:t.label,color:t.color,icon:t.icon,badge:t.badge}))
          ].map(t => (
            <button key={t.id} onClick={()=>setActiveTier(t.id)}
              style={{ padding:"6px 12px", borderRadius:"8px", border:"none",
                cursor:"pointer", fontSize:"11px", fontWeight:700, transition:"all .13s",
                background: activeTier===t.id ? (t.color||"var(--gray-800)") : "var(--gray-100)",
                color: activeTier===t.id ? "#fff" : "var(--gray-500)" }}>
              {t.icon&&<span style={{ marginRight:4 }}>{t.icon}</span>}{t.label}
            </button>
          ))}
        </div>
        {search && (
          <span style={{ fontSize:"12px", color:"#94a3b8" }}>
            {filtered.length} result{filtered.length!==1?"s":""}
          </span>
        )}
      </div>

      {/* Tier sections */}
      {activeTier === "all" ? (
        TIERS.map(tier => {
          const tFiltered = tier.integrations.filter(i =>
            !search || i.name.toLowerCase().includes(search.toLowerCase()) ||
            i.tagline.toLowerCase().includes(search.toLowerCase())
          );
          if (tFiltered.length === 0) return null;
          return (
            <div key={tier.id} style={{ marginBottom:"32px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"14px" }}>
                <span style={{ fontSize:"20px" }}>{tier.icon}</span>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                    <span style={{ fontWeight:800, fontSize:"16px", color:"#0f172a" }}>{tier.label}</span>
                    <span style={{ fontSize:"10px", fontWeight:800, padding:"2px 9px",
                      borderRadius:"999px", letterSpacing:".05em",
                      background:`${tier.color}18`, color:tier.color }}>{tier.badge}</span>
                  </div>
                  <div style={{ fontSize:"12px", color:"#64748b", marginTop:"2px" }}>{tier.desc}</div>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:"10px" }}>
                {tFiltered.map(intg => (
                  <IntegrationCard key={intg.key} intg={intg}
                    savedConfig={savedConfigs[intg.key]}
                    onConfigure={setConfiguringIntg}
                    onToggle={handleToggle} />
                ))}
              </div>
            </div>
          );
        })
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:"10px" }}>
          {filtered.map(intg => (
            <IntegrationCard key={intg.key} intg={intg}
              savedConfig={savedConfigs[intg.key]}
              onConfigure={setConfiguringIntg}
              onToggle={handleToggle} />
          ))}
        </div>
      )}

      {/* Configure modal */}
      {configuringIntg && (
        <ConfigureModal intg={configuringIntg}
          existing={savedConfigs[configuringIntg.key]}
          onSave={handleSave}
          onClose={()=>setConfiguringIntg(null)} />
      )}
    </div>
  );
}
