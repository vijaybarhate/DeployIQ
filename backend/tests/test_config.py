"""Tests: env-file resolution (root .env, CWD fallback, shell precedence).

Uses only synthetic sentinel values in temp files — never the real .env.
"""

import textwrap
from pathlib import Path

from app.config import ENV_FILE, REPO_ROOT, Settings, resolve_env_file


def test_env_file_resolves_to_repo_root():
    assert REPO_ROOT.name == "DeployIQ"
    # Module binding must equal the pure resolution function (no drift).
    assert ENV_FILE == resolve_env_file(REPO_ROOT, Path.cwd())


def test_tmp_env_file_is_read(tmp_path, monkeypatch):
    for var in ("MONITORED_PROJECTS", "LOG_LEVEL", "DATABASE_URL"):
        monkeypatch.delenv(var, raising=False)
    env = tmp_path / ".env"
    env.write_text(
        textwrap.dedent("""\
        MONITORED_PROJECTS=alpha,beta
        LOG_LEVEL=DEBUG
    """)
    )
    settings = Settings(_env_file=str(env))
    assert settings.monitored_project_list == ["alpha", "beta"]
    assert settings.log_level == "DEBUG"


def test_shell_env_beats_env_file(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("LOG_LEVEL=DEBUG\n")
    monkeypatch.setenv("LOG_LEVEL", "WARNING")
    settings = Settings(_env_file=str(env))
    assert settings.log_level == "WARNING"


def test_cwd_fallback_when_root_env_missing(tmp_path):
    from app.config import resolve_env_file

    root_without_env = tmp_path / "projroot"
    root_without_env.mkdir()
    assert resolve_env_file(root_without_env, tmp_path) == tmp_path / ".env"
    root_with_env = tmp_path / "realroot"
    root_with_env.mkdir()
    (root_with_env / ".env").write_text("LOG_LEVEL=ERROR\n")
    assert resolve_env_file(root_with_env, tmp_path) == root_with_env / ".env"
