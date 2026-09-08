import { useState, useEffect, useCallback } from "react";
import client from "../api/client";

// Hook: returns connected integrations and action helpers
export function useIntegrations() {
  const [integrations, setIntegrations] = useState({});
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    client.get("/integrations")
      .then(res => {
        const map = {};
        (Array.isArray(res.data) ? res.data : res.data?.data || [])
          .filter(i => i.enabled)
          .forEach(i => { map[(i.key || i.type || "").toUpperCase()] = i; });
        setIntegrations(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const isConnected = useCallback((key) => !!integrations[key?.toUpperCase()], [integrations]);

  // Confluence
  const searchConfluence = useCallback(async (q) => {
    const res = await client.get("/integrations/confluence/search", { params: { q } });
    return res.data?.results || [];
  }, []);

  const confluenceSpaces = useCallback(async () => {
    const res = await client.get("/integrations/confluence/spaces");
    return res.data?.results || [];
  }, []);

  const createConfluencePage = useCallback(async (spaceKey, title, content) => {
    const res = await client.post("/integrations/confluence/pages", { spaceKey, title, content });
    return res.data;
  }, []);

  // Slack
  const slackNotify = useCallback(async (title, message, color) => {
    const res = await client.post("/integrations/slack/notify", { title, message, color });
    return res.data;
  }, []);

  return { integrations, loading, isConnected,
    searchConfluence, confluenceSpaces, createConfluencePage, slackNotify };
}
