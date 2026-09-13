"""The account type enum (DESIGN.md § Account type). Plain strings in the database; this is
the one list of valid values, and the one place each type's default budget side lives.

Account type has exactly three consumers (form defaults/labels, net-worth grouping, the
investment short-horizon note) — nothing else may branch on it.
"""

# name -> default on_budget value the create form pre-fills (the user can still change it).
ACCOUNT_TYPES: dict[str, bool] = {
    "Asset": False,
    "Cash": True,
    "Chequing": True,
    "Credit card": True,
    "Investment": False,
    "Line of credit": False,
    "Loan": False,
    "Mortgage": False,
    "Payment plan": False,
    "Savings": True,
}
