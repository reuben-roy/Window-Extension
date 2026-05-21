"""Registry of all quiz banks to emit into quizzes-cleaned/."""
from __future__ import annotations

from quiz_banks.algorithms import BOOK as ALGORITHMS
from quiz_banks.calculus import BOOK as CALCULUS
from quiz_banks.databases import BOOK as DATABASES
from quiz_banks.deep_learning import BOOK as DEEP_LEARNING
from quiz_banks.discrete_math import BOOK as DISCRETE_MATH
from quiz_banks.distributed_systems import BOOK as DISTRIBUTED_SYSTEMS
from quiz_banks.linear_algebra import BOOK as LINEAR_ALGEBRA
from quiz_banks.logic import BOOK as LOGIC
from quiz_banks.machine_learning import BOOK as MACHINE_LEARNING
from quiz_banks.networking import BOOK as NETWORKING
from quiz_banks.operating_systems import BOOK as OPERATING_SYSTEMS
from quiz_banks.probability import BOOK as PROBABILITY
from quiz_banks.reinforcement_learning import BOOK as REINFORCEMENT_LEARNING
from quiz_banks.statistics import BOOK as STATISTICS
from quiz_banks.transformers import BOOK as TRANSFORMERS


def all_books():
    return [
        ALGORITHMS,
        MACHINE_LEARNING,
        REINFORCEMENT_LEARNING,
        PROBABILITY,
        LOGIC,
        OPERATING_SYSTEMS,
        DISTRIBUTED_SYSTEMS,
        DATABASES,
        NETWORKING,
        LINEAR_ALGEBRA,
        STATISTICS,
        DISCRETE_MATH,
        DEEP_LEARNING,
        TRANSFORMERS,
        CALCULUS,
    ]
