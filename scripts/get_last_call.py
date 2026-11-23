import json
import psycopg2

conn = psycopg2.connect("postgres://postgres:ARJUNGAMING@localhost:5432/right_agent_group")
cur = conn.cursor()
cur.execute("SELECT id, phone, twilio_call_sid, direction, duration, status, outcome, sentiment, recording_url, transcript FROM voice_calls WHERE id = %s", ('086df564-b9f5-4197-8385-5436a00b7495',))
row = cur.fetchone()
cols = [desc[0] for desc in cur.description]
data = dict(zip(cols, row))
print(json.dumps(data, indent=2, default=str))
conn.close()
