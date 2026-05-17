"""System prompts for the agent pipeline.

Loaded from sibling .txt files at startup so prompts are reviewable
in diffs. Phase 8 introduces DB-driven versioning via
``prompt_versions``; Phase 6 hard-codes v1 by reading the files.

Step 5 lands ``research_system.txt``;
Step 7 lands ``cert_judge.txt`` and ``ref_verifier.txt``.
"""
