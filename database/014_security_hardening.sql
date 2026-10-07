CREATE INDEX IF NOT EXISTS sessions_user_created
  ON sessions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS oauth_login_states_created
  ON oauth_login_states(created_at);
