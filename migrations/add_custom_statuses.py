import subprocess

sql = """
ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS status_reason text;
ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS remarks text;
ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS status_history jsonb DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS custom_loan_statuses (
    id text PRIMARY KEY,
    label text NOT NULL,
    color text NOT NULL DEFAULT '#8B5CF6',
    bg_color text NOT NULL DEFAULT 'rgba(139,92,246,0.15)',
    icon text NOT NULL DEFAULT '📌',
    category text NOT NULL DEFAULT 'pending',
    is_default boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 10,
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO custom_loan_statuses (id, label, color, bg_color, icon, category, is_default, sort_order)
VALUES 
  ('pending', 'Under Review / Pending', '#EAB308', 'rgba(234,179,8,0.15)', '⏳', 'pending', true, 1),
  ('sanctioned', 'Sanctioned', '#38BDF8', 'rgba(56,189,248,0.15)', '✅', 'sanctioned', true, 2),
  ('rejected', 'Not Sanctioned / Rejected', '#EF4444', 'rgba(239,68,68,0.15)', '❌', 'rejected', true, 3),
  ('disbursed', 'Disbursed', '#22C55E', 'rgba(34,197,94,0.15)', '💰', 'disbursed', true, 4)
ON CONFLICT (id) DO NOTHING;
"""

remote_cmd = f"sudo -u postgres psql -d right_agent_group -P pager=off -c \"{sql}\""

res = subprocess.run([
    'ssh', '-o', 'StrictHostKeyChecking=no',
    '-i', r'C:\Users\Lenovo\.ssh\LightsailDefaultKey-ap-south-1.pem',
    'ubuntu@13.201.0.111',
    remote_cmd
], capture_output=True, text=True)

print("STDOUT:\n" + res.stdout)
if res.stderr:
    print("STDERR:\n" + res.stderr)
