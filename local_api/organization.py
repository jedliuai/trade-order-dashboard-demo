"""Fictional reporting tree, shared with the UI; these are demo scopes, not logins."""
import json
from functools import cache
from pathlib import Path

ACCOUNTS = json.loads((Path(__file__).resolve().parents[1] /
                      'frontend/src/data/demoOrganization.json').read_text(encoding='utf-8'))
BY_ID = {a['id']: a for a in ACCOUNTS}
USERS = tuple(BY_ID)
SALES = tuple(a['id'] for a in ACCOUNTS if a['role'] == 'member')


@cache
def descendants(user):
    """Include self and all descendants, with no fixed number of tree levels."""
    allowed = {user} if user in BY_ID else set()
    while True:
        expanded = allowed | {a['id'] for a in ACCOUNTS if a['parentId'] in allowed}
        if expanded == allowed:
            return frozenset(allowed)
        allowed = expanded


def resolve_scope(user, requested=None):
    from .store import ApiError, check_user
    check_user(user)
    scope = requested or user
    if scope not in descendants(user):
        raise ApiError('无权查看所选区域或业务员', 403, 'forbidden_scope')
    return scope
