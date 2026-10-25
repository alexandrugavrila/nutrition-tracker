"""Compatibility entry point; prefer python -m Backend.commands.seed_starter_data."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from Backend.commands.seed_starter_data import main
if __name__ == "__main__":
    raise SystemExit(main())
