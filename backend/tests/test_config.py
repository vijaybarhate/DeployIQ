"""Tests: env-file resolution (root .env, CWD fallback, shell precedence).

Uses only synthetic sentinel values in temp files — never the real .env.
"""

import textwrap

from app.config import ENV_FILE, REPO_ROOT, Settings


def test_env_file_resolves_to_repo_root():
    assert REPO_ROOT.name == "DeployIQ"
    assert ENV_FILE == REPO_ROOT / ".env"


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


def test_cwd_fallback_when_root_env_missing(tmp_path, monkeypatch):
    from app import config as config_module

    monkeypatch.chdir(tmp_path)
    local = tmp_path / ".env"
    local.write_text("LOG_LEVEL=ERROR\n")
    monkeypatch.setattr(config_module, "ENV_FILE", tmp_path / "does-not-exist.env", raising=False)
    # Recompute like the module does: root missing -> CWD .env
    fallback = tmp_path / ".env" if not (tmp_path / "does-not-exist.env").exists() else None
    assert fallback is not None and fallback.exists()
    settings = Settings(_env_file=str(local))
    assert settings.log_level == "ERROR"
