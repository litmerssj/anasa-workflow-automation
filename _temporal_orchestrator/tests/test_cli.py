from anasa_orchestrator.cli import _parser


def test_cli_accepts_health_command() -> None:
    assert _parser().parse_args(["health"]).command == "health"
