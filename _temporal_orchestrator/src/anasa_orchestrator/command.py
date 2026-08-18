from __future__ import annotations

import asyncio
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class CommandResult:
    stdout: str
    stderr: str
    returncode: int


class CommandError(RuntimeError):
    def __init__(self, args: Sequence[str], result: CommandResult) -> None:
        rendered = " ".join(args)
        detail = result.stderr.strip() or result.stdout.strip() or "no output"
        super().__init__(f"command failed ({result.returncode}): {rendered}: {detail}")
        self.args_list = tuple(args)
        self.result = result


async def run_command(
    args: Sequence[str],
    *,
    cwd: Path | None = None,
    env: Mapping[str, str] | None = None,
    check: bool = True,
) -> CommandResult:
    process_env = os.environ.copy()
    if env:
        process_env.update(env)
    process = await asyncio.create_subprocess_exec(
        *args,
        cwd=str(cwd) if cwd else None,
        env=process_env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    result = CommandResult(
        stdout=stdout.decode("utf-8", errors="replace"),
        stderr=stderr.decode("utf-8", errors="replace"),
        returncode=process.returncode or 0,
    )
    if check and result.returncode != 0:
        raise CommandError(args, result)
    return result
