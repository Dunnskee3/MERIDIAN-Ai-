// MERIDIAN — Secure Analysis Proxy
// API key sourced from Vercel environment only.
// Never logged. Never returned to client. Never hardcoded.

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { transcript, meetingType, duration, modules } = req.body || {};

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
    res.status(400).json({ error: 'Transcript is required' }); return;
  }

  if (transcript.length > 60000) {
    res.status(400).json({ error: 'Transcript too long (60,000 char max)' }); return;
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) { res.status(500).json({ error: 'Service not configured' }); return; }

  const mods = Array.isArray(modules) ? modules : [];

  const systemPrompt = `You are MERIDIAN, an elite AI meeting intelligence engine used by enterprise executives. Analyze meeting transcripts with surgical precision. Always respond with valid JSON only — no markdown, no explanation, no text outside the JSON object.`;

  const userPrompt = `Analyze this${meetingType ? ' ' + meetingType : ''} meeting transcript${duration ? ' (' + duration + ')' : ''}.

TRANSCRIPT:
---
${transcript.trim()}
---

Return ONLY a valid JSON object using this structure. Only include sections for these modules: ${mods.join(', ')}.

{
  "meta": {
    "title": "concise meeting title",
    "participants": ["speaker names"],
    "duration_estimate": "estimated duration",
    "meeting_type": "type of meeting",
    "topics": ["5 to 8 key topics"],
    "total_action_items": 0,
    "total_decisions": 0,
    "total_risks": 0,
    "overall_sentiment": "positive or neutral or negative or mixed"
  }${mods.includes('summary') ? `,
  "summary": {
    "executive_summary": "2 to 3 paragraph C-level summary",
    "key_outcomes": ["3 to 5 concrete outcomes"],
    "meeting_effectiveness": 80
  }` : ''}${mods.includes('actions') ? `,
  "action_items": [
    {
      "task": "specific task",
      "owner": "person or Unassigned",
      "due_date": "timeframe or Not specified",
      "priority": "high or medium or low",
      "context": "why this matters"
    }
  ]` : ''}${mods.includes('decisions') ? `,
  "decisions": [
    {
      "decision": "what was decided",
      "rationale": "why",
      "impact": "business impact",
      "decision_maker": "who decided"
    }
  ]` : ''}${mods.includes('risks') ? `,
  "risks": [
    {
      "risk": "risk description",
      "severity": "high or medium or low",
      "category": "technical or financial or timeline or resource or strategic or compliance",
      "mitigation": "suggested mitigation",
      "owner": "who owns this"
    }
  ]` : ''}${mods.includes('speakers') ? `,
  "speakers": [
    {
      "name": "speaker name",
      "role_inferred": "inferred title",
      "participation_level": "high or medium or low",
      "key_contributions": "summary of contributions",
      "sentiment_score": 75,
      "talk_ratio": 25
    }
  ]` : ''}${mods.includes('followups') ? `,
  "follow_ups": ["specific follow-up items needed"]` : ''}
}`;

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.2,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   }
        ]
      })
    });

    if (!upstream.ok) {
      const err = await upstream.json();
      res.status(upstream.status).json({ error: err.error?.message || 'Upstream error' });
      return;
    }

    const data  = await upstream.json();
    const raw   = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw); // throws if invalid — caught below

    res.status(200).json(parsed);

  } catch (err) {
    res.status(500).json({ error: 'Analysis failed — please try again.' });
  }
};
