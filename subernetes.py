#!/usr/bin/env python3
from re import sub
from typing import Callable


def translate_words(text: str, translate: Callable[[str], str]) -> str:
    return sub(r"\w+", lambda m: translate(m.group()), text)


def subernetes_word(word: str) -> str:
    return word if len(word) <= 2 else f"{word[0]}{len(word) - 2}{word[-1]}"


def subernetes(text: str) -> str:
    return translate_words(text, subernetes_word)


def un_subernetes_word(word: str) -> str:
    return (
        word
        if len(word) <= 2
        else f"{word[0]}{'subernetes'[1:-1][:int(word[1:-1])]}{word[-1]}"
    )


def un_subernetes(text: str) -> str:
    return translate_words(text, un_subernetes_word)


text = 'Datadog is a leader in a niche known as "Kubernetes," according to Barron\'s. Kubernetes is the Greek word for helmsman or pilot. It is a way for an application to be scaled across a number of different servers, clouds or operating systems. A good example is Gmail, which is Kubernetes so that a billion users can use the same application.'
print(text)
print()
print(subernetes(text))
print()
print(un_subernetes(subernetes(text)))
print()