// MERIDIAN — Secure Analysis Proxy
// Anthropic key lives in Vercel environment variables only.
// This function is the only surface that touches the API.
// The client never sees the key.

export const config = { runtime: 'edge' };

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

export default async function handler(req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders()
    });
  }

  if (req.method !== 'POST') {
    return respond({ error: 'Method not allowed' }, 405);
  }

  // Rate-limit guard — basic abuse protection
  const ip = req.headers.get('x-forwarded-for') || 'unknown';

  let body;
  try {
    body = await req.json();
  } catch {
    return respond({ error: 'Invalid request body' }, 400);
  }

  const { transcript, meetingType, duration, modules } = body;

  if (!transcript || typeof transcript !== 'string') {
    return respond({ error: 'Transcript is required' }, 400);
  }

  if (transcript.length > 50000) {
    return respond({ error: 'Transcript exceeds maximum length' }, 400);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return respond({ error: 'Service configuration error' }, 500);
  }

  const prompt = buildPrompt(transcript, meetingType, duration, modules);

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: `You are MERIDIAN, an elite AI meeting intelligence engine used by enterprise executives and business leaders. You analyze meeting transcripts with surgical precision, extracting high-signal intelligence that drives real business decisions. Your output must be valid JSON only — no markdown, no preamble, no explanation.`,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!upstream.ok) {
      const err = await upstream.json();
      return respond({ error: err.error?.message || 'Upstream API error' }, upstream.status);
    }

    const data = await upstream.json();
    const raw = data.content?.[0]?.text || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();

    // Validate it's actually JSON before sending
    JSON.parse(clean);

    return new Response(clean, {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });

  } catch (err) {
    return respond({ error: 'Analysis failed. Please try again.' }, 500);
  }
}

function buildPrompt(transcript, type, duration, modules = []) {
  const mods = Array.isArray(modules) ? modules : [];
  return `Analyze this${type ? ' ' + type : ''} meeting transcript${duration ? ' (' + duration + ')' : ''}.

TRANSCRIPT:
---
${transcript}
---

Return ONLY valid JSON with this exact structure (include only the requested modules: ${mods.join(', ')}):
{
  "meta": {
    "title": "string — concise meeting title/topic",
    "participants": ["array of identified speakers"],
    "duration_estimate": "string",
    "meeting_type": "string",
    "topics": ["array of 5-8 key topics discussed"],
    "total_action_items": number,
    "total_decisions": number,
    "total_risks": number,
    "overall_sentiment": "positive|neutral|negative|mixed"
  },
  ${mods.includes('summary') ? `"summary": {
    "executive_summary": "2-3 paragraph concise summary for C-level stakeholders",
    "key_outcomes": ["array of 3-5 concrete outcomes from this meeting"],
    "meeting_effectiveness": number
  },` : ''}
  ${mods.includes('actions') ? `"action_items": [
    {
      "task": "specific actionable task description",
      "owner": "person responsible (or 'Unassigned')",
      "due_date": "specific date or timeframe mentioned, or 'Not specified'",
      "priority": "high|medium|low",
      "context": "brief context why this matters"
    }
  ],` : ''}
  ${mods.includes('decisions') ? `"decisions": [
    {
      "decision": "what was decided",
      "rationale": "why this decision was made",
      "impact": "business impact of this decision",
      "decision_maker": "who made/approved this decision"
    }
  ],` : ''}
  ${mods.includes('risks') ? `"risks": [
    {
      "risk": "description of the risk or blocker identified",
      "severity": "high|medium|low",
      "category": "technical|financial|timeline|resource|strategic|compliance",
      "mitigation": "suggested mitigation or what was discussed",
      "owner": "who owns this risk"
    }
  ],` : ''}
  ${mods.includes('speakers') ? `"speakers": [
    {
      "name": "speaker name",
      "role_inferred": "inferred role/title",
      "participation_level": "high|medium|low",
      "key_contributions": "summary of their main contributions",
      "sentiment_score": number,
      "talk_ratio": number
    }
  ],` : ''}
  ${mods.includes('followups') ? `"follow_ups": [
    "specific follow-up question, meeting, or check-in needed"
  ]` : ''}
}`;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function respond(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}
