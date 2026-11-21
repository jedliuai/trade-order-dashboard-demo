"""The business model has one member inside each authenticated D1 workspace."""
SALES = USERS = ('personal',)


def descendants(user):
    return frozenset((user,)) if user in USERS else frozenset()
