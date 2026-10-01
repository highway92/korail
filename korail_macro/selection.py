from .models import Train, Candidate


def choose_candidate(trains, config, rng):
    eligible = {}
    for train in trains:
        if train.key not in config.targets:
            continue
        classes = set(train.available_classes) & set(config.allowed_classes)
        if classes:
            prior = eligible.get(train.key)
            if prior:
                classes.update(prior.available_classes)
            eligible[train.key] = Train(train.key, tuple(c for c in config.allowed_classes if c in classes), train.label)
    if not eligible:
        return None
    options = list(eligible.values())
    train = min(options, key=lambda t: config.preference.index(t.key.id)) if config.preference else rng.choice(options)
    return Candidate(train, rng.choice(train.available_classes))
