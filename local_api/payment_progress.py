"""Same cumulative prepayment milestone as the upstream paymentProgress service."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from .store import number


def china_today():
    return datetime.now(timezone(timedelta(hours=8))).date()


def prepayment_date(contract, total, payments):
    if total <= Decimal('.005'):
        return None
    ratio = number(contract.get('prepayment_ratio', '.3'))
    if ratio <= 0:
        return contract.get('contract_date')
    cumulative = Decimal(0)
    ordered = sorted(payments, key=lambda p: (p.get('allocation_effective_date') or p.get('payment_date') or '',
                                             p.get('created_at') or '', p['id']))
    for payment in ordered:
        cumulative += number(payment['amount'])
        if cumulative + Decimal('.005') >= total * ratio:
            return payment.get('allocation_effective_date') or payment.get('payment_date')
    return None
