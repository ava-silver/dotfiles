#!/usr/bin/env zsh

#  -------------------------------GENERAL----------------------------------
alias cp='cp -riv'       # Preferred 'cp' implementation
alias mv='mv -iv'        # Preferred 'mv' implementation
alias mkdir='mkdir -pv'  # Preferred 'mkdir' implementation
alias less='less -FSRXc' # Preferred 'less' implementation
alias wget='wget -c'
alias cat=bat     # Preferred 'cat' implementation
alias ccat='\cat' # In case regular cat usage is preferred
alias top=btm     # Preferred 'top' implementation
alias c=clear
alias cd=z
alias src='exec zsh'
alias g=git
alias path='echo -e ${PATH//:/\\n}' # path:         Echo all executable Paths
alias fix_term='echo -e "\033c"'    # fix_term:     Reset the conosle.  Similar to the reset command
alias qfind='find . -iname'         # qfind:    Quickly search for file
alias zip='zip -r'
alias rm=rip
alias rrm='/bin/rm -rf'
alias time='=time'
alias lower='tr "[:upper:]" "[:lower:]"'
alias upper='tr "[:lower:]" "[:upper:]"'
alias uuid='uuidgen | lower | tee /dev/tty | xclip'
alias sed=gsed
alias pinentry='pinentry-mac'
alias gotest='gotestsum'
#  -------------------------------LS----------------------------------
# Directory Listing aliases
alias ls=lsd        # Preferred ls implementation
alias l=ls          # short listing, all files
alias l.='ls -d .*' # short listing, only hidden files - .*
alias la='ls -A'    # show hidden files
alias ll='ls -lAh'  # long
alias L='ls -lathF' # long, sort by oldest to newest
alias lr='ls -R | grep ":$" | sed -e '\''s/:$//'\'' -e '\''s/[^-][^\/]*\//--/g'\'' -e '\''s/^/   /'\'' -e '\''s/-/|/'\'' | less'

alias celeste="cd '/Users/ava.silver/Library/Application Support/Celeste'"

#  -------------------------------MISC----------------------------------
alias urldecode="python -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]))'"
alias urlencode="python -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1].strip(), safe=\"\"))'"
alias xclip="pbcopy"

alias brewi="brew update && brew install -y"
alias brewr="brew uninstall"
alias brewu="brew update && brew upgrade -y"

#  -------------------------------K8s----------------------------------
alias kgp="k get pod"
alias kbash="kbash --pod"
alias k=kubectl
alias ktx="kubectx-switcher"
alias kns=kubens
alias hd=hotdog

#  -------------------------------terraform---------------------------------

alias tf="terraform"
alias tfa="terraform apply -auto-approve"
alias tfd="terraform destroy -auto-approve"
alias tfr="terraform destroy -auto-approve && terraform apply -auto-approve"

#  -------------------------------bazel------------------------------------

alias gz='bzl run //:gazelle -- domains/cloud_platform/ && g ac gazelle && gt ss'

python() {
    if [[ $# == 0 ]]; then ipython; else python3 $@; fi
}

write_token() {
    printf "Enter env var name (e.g. FOOBAR_TOKEN): " &&
        read TOKEN_NAME &&
        printf "Enter API token value: " &&
        read TOKEN &&
        security add-generic-password -U -a ${USER} -s ${TOKEN_NAME} -w ${TOKEN} &&
        unset TOKEN &&
        unset TOKEN_NAME
}

store_token() {
    printf "Enter env var name (e.g. FOOBAR_TOKEN): " &&
        read TOKEN_NAME &&
        printf "Enter API token value: " &&
        read TOKEN &&
        security add-generic-password -U -a ${USER} -s ${TOKEN_NAME} -w ${TOKEN} &&
        unset TOKEN
    TO_WRITE="\nexport ${TOKEN_NAME}="
    TO_WRITE+='$(security find-generic-password -a ${USER}'
    TO_WRITE+=" -s ${TOKEN_NAME} -w)"
    echo -e "${TO_WRITE}" >>~/.zshrc
    unset TOKEN_NAME
    source ~/.zshrc
}


install-hooks() {
    command -v prek &>/dev/null || brew install prek
    local hooks_path
    hooks_path=$(git config --global core.hooksPath)
    [[ -n "$hooks_path" ]] && git config --global --unset core.hooksPath
    prek install
    [[ -n "$hooks_path" ]] && git config --global core.hooksPath "$hooks_path"
}

if [[ -f ~/.zsh_aliases.local ]]; then
    source ~/.zsh_aliases.local
fi

awsopen() {
    open -a "Google Chrome" "https://console.aws.amazon.com/go/view?arn=$1"
}
# Resolves a leading alias in the given words into the `expanded_cmd` array,
# so wrapper functions accept aliases as arguments the way a shell would.
expand-alias() {
    typeset -ga expanded_cmd=("$@")
    local -i depth=0
    while (( $+aliases[$expanded_cmd[1]] && depth++ < 16 )); do
        expanded_cmd=("${(@Q)${(z)aliases[$expanded_cmd[1]]}}" "${expanded_cmd[@]:1}")
    done
}

# Runs a command under the sandbox AWS profile, expanding a leading alias
# (e.g. `aws-sso tfa` -> `aws-vault exec ... -- terraform apply -auto-approve`).
aws-sso() {
    expand-alias "$@"
    aws-vault exec sso-serverless-sandbox-account-admin -- "${expanded_cmd[@]}"
}

# Reruns a command forever, sleeping between iterations (`loop -n 5 tfa`).
loop() {
    local interval=1
    if [[ $1 == -n ]]; then
        interval=$2
        shift 2
    fi
    expand-alias "$@"
    local -a cmd=("${expanded_cmd[@]}")
    while true; do
        "${cmd[@]}"
        sleep "$interval"
    done
}
alias aws='aws-sso /opt/homebrew/bin/aws'

dd-auth-session() {
    eval "$(dd-auth --output --domain "$@" | sed 's/^/export /')"
}

alias bunup='(cd ~/.bun/install/global && bun update)'
alias bunupdate=bunup

alias disablesleep='sudo pmset -a disablesleep 1'
alias enablesleep='sudo pmset -a disablesleep 0'

alias code=zed

alias pis='pi --model openai-codex/gpt-5.6-sol --thinking medium'

piredact() {
    if [[ $# != 1 ]]; then
        printf 'Usage: piredact <seeker-slack-message-url>\n' >&2
        return 2
    fi

    pi --no-session --model dd-ai-gateway/baseten/deepseek-ai/DeepSeek-V4-Flash-0731 \
        "Read the Seeker alert at $1. Print a short progress update before reading the alert, before redacting, and after verification. Collect every reported local file path that exists, then run exactly one command to redact and verify them: redact-secrets -- <absolute-path>... Do not read or print secret values yourself."
}
