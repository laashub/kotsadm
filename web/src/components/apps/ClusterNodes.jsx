import React, { Component, Fragment } from "react";
import classNames from "classnames";
import moment from "moment";
import { graphql, compose, withApollo } from "react-apollo";
import { withRouter } from "react-router-dom";
import { Helmet } from "react-helmet";
import CodeSnippet from "../shared/CodeSnippet";
import NodeRow from "./NodeRow";
import Loader from "../shared/Loader";
import { kurl } from "../../queries/KurlQueries";
import { drainNode, deleteNode } from "../../mutations/KurlMutations"
import { Utilities } from "../../utilities/utilities";

import "@src/scss/components/apps/ClusterNodes.scss";

export class ClusterNodes extends Component {
  state = {
    generating: false,
    command: "",
    expiry: null,
    displayAddNode: false,
    selectedNodeType: "worker", // Change when master node script is enabled
    generateCommandErrMsg: ""
  }

  drainNode = (name) => {
    try {
      this.props.drainNode(name);
      // feedback here showing the node was drained?
    } catch (error) {
      console.log(error)
    }
  }

  deleteNode = (name) => {
    try {
      this.props.deleteNode(name);
      // reflect nodes so deleted node is from the list?
    } catch (error) {
      console.log(error);
    }
  }

  generateWorkerAddNodeCommand = async () => {
    this.setState({ generating: true, command: "", expiry: null, generateCommandErrMsg: "" });

    fetch(`${window.env.API_ENDPOINT}/kurl/generate-node-join-command-worker`, {
      headers: {
        "Authorization": `${Utilities.getToken()}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      method: "POST",
    })
      .then(async (res) => {
        const data = await res.json();
        this.setState({ generating: false, command: data.command, expiry: data.expiry });
      })
      .catch((err) => {
        err.graphQLErrors.map(({ msg }) => {
          this.setState({ generating: false, generateCommandErrMsg: msg });
        });
      });
  }

  generateMasterAddNodeCommand = async () => {
    this.setState({ generating: true, command: "", expiry: null, generateCommandErrMsg: "" });

    fetch(`${window.env.API_ENDPOINT}/kurl/generate-node-join-command-master`, {
      headers: {
        "Authorization": `${Utilities.getToken()}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      method: "POST",
    })
      .then(async (res) => {
        const data = await res.json();
        this.setState({ generating: false, command: data.command, expiry: data.expiry });
      })
      .catch((err) => {
        err.graphQLErrors.map(({ msg }) => {
          this.setState({ generating: false, generateCommandErrMsg: msg });
        });
      });
  }

  onAddNodeClick = () => {
    this.setState({
      displayAddNode: true
    }, async () => {
      await this.generateWorkerAddNodeCommand();
    });
  }
  
  onSelectNodeType = event => {
    const value = event.currentTarget.value;
    this.setState({
      selectedNodeType: value
    }, async () => {
      if (this.state.selectedNodeType === "worker") {
        await this.generateWorkerAddNodeCommand();
      } else {
        await this.generateMasterAddNodeCommand();
      }
    });
  }

  render() {
    const { kurl } = this.props.data;
    const { displayAddNode, generateCommandErrMsg } = this.state;

    if (!kurl) {
      return (
        <div className="flex-column flex1 alignItems--center justifyContent--center">
          <Loader size="60" />
        </div>
      );
    }
    return (
      <div className="ClusterNodes--wrapper container flex-column flex1 u-overflow--auto u-paddingTop--50">
        <Helmet>
          <title>{`${this.props.appName ? `${this.props.appName} Admin Console` : "Admin Console"}`}</title>
        </Helmet>
        <div className="flex-column flex1 alignItems--center">
          <div className="flex1 flex-column centered-container">
            <div className="u-paddingBottom--30">
              <p className="flex-auto u-fontSize--larger u-fontWeight--bold u-color--tuna u-paddingBottom--10">Your nodes</p>
              <div className="flex1 u-overflow--auto">
                {kurl?.nodes && kurl?.nodes.map((node, i) => (
                  <NodeRow
                    key={i}
                    node={node}
                    drainNode={kurl?.isKurlEnabled ? this.drainNode : null}
                    deleteNode={kurl?.isKurlEnabled ? this.deleteNode : null} />
                ))}
              </div>
            </div>
            {kurl?.isKurlEnabled ?
              !displayAddNode
                ? (
                  <div className="flex justifyContent--center alignItems--center">
                    <button className="btn primary" onClick={this.onAddNodeClick}>Add a node</button>
                  </div>
                )
                : (
                  <div className="flex-column">
                    <div>
                      <p className="u-width--full u-fontSize--larger u-color--tuna u-fontWeight--bold u-lineHeight--normal u-borderBottom--gray u-paddingBottom--10">
                        Add a Node
                      </p>
                    </div>
                    <div className="flex justifyContent--center alignItems--center u-marginTop--15">
                      <div className={classNames("BoxedCheckbox flex-auto flex u-marginRight--20", {
                        "is-active": this.state.selectedNodeType === "master",
                        "is-disabled": !kurl?.ha
                      })}>
                        <input
                          id="masterNode"
                          className="u-cursor--pointer hidden-input"
                          type="radio"
                          name="nodeType"
                          value="master"
                          disabled={!kurl?.ha}
                          checked={this.state.selectedNodeType === "master"}
                          onChange={this.onSelectNodeType}
                        />
                        <label 
                          htmlFor="masterNode"
                          className="flex1 flex u-width--full u-position--relative u-cursor--pointer u-userSelect--none">
                          <div className="flex-auto">
                            <span className="icon clickable commitOptionIcon u-marginRight--10" />
                          </div>
                          <div className="flex1">
                            <p className="u-color--tuna u-fontSize--normal u-fontWeight--medium">Master Node</p>
                            <p className="u-color--dustyGray u-lineHeight--normal u-fontSize--small u-fontWeight--medium u-marginTop--5">Provides high availability</p>
                          </div>
                        </label>
                      </div>
                      <div className={classNames("BoxedCheckbox flex-auto flex u-marginRight--20", {
                        "is-active": this.state.selectedNodeType === "worker"
                      })}>
                        <input
                          id="workerNode"
                          className="u-cursor--pointer hidden-input"
                          type="radio"
                          name="nodeType"
                          value="worker"
                          checked={this.state.selectedNodeType === "worker"}
                          onChange={this.onSelectNodeType}
                        />
                        <label htmlFor="workerNode" className="flex1 flex u-width--full u-position--relative u-cursor--pointer u-userSelect--none">
                          <div className="flex-auto">
                            <span className="icon clickable commitOptionIcon u-marginRight--10" />
                          </div>
                          <div className="flex1">
                            <p className="u-color--tuna u-fontSize--normal u-fontWeight--medium">Worker Node</p>
                            <p className="u-color--dustyGray u-lineHeight--normal u-fontSize--small u-fontWeight--medium u-marginTop--5">Optimal for running application workloads</p>
                          </div>
                        </label>
                      </div>  
                    </div>
                    {this.state.generating && (
                      <div className="flex u-width--full justifyContent--center">
                        <Loader size={60} />
                      </div>
                    )}
                    {!this.state.generating && this.state.command.length > 0 
                      ? (
                        <Fragment>
                          <p className="u-fontSize--normal u-color--dustyGray u-fontWeight--medium u-lineHeight--normal u-marginBottom--5 u-marginTop--15">
                            Run this command on the node you wish to join the cluster
                          </p>
                          <CodeSnippet
                            language="bash"
                            canCopy={true}
                            onCopyText={<span className="u-color--chateauGreen">Command has been copied to your clipboard</span>}
                          >
                            {[this.state.command.join(" \\\n  ")]}
                          </CodeSnippet>
                          {this.state.expiry && (
                            <div className="timestamp u-marginTop--15 u-width--full u-textAlign--right u-fontSize--small u-fontWeight--bold u-color--tuna">
                              {`Expires on ${moment(this.state.expiry).format("MMM Do YYYY, h:mm:ss a z")} UTC${ -1 * (new Date().getTimezoneOffset()) / 60}`}
                            </div>
                          )}
                        </Fragment>
                      )
                      : (
                        <Fragment>
                          {generateCommandErrMsg &&
                            <div className="alignSelf--center u-marginTop--15">
                              <span className="u-color--chestnut">{generateCommandErrMsg}</span>
                            </div>
                          }
                        </Fragment>
                      )
                    }
                  </div>
                )
            : null}
          </div>
        </div>
      </div>
    );
  }
}

export default compose(
  withRouter,
  withApollo,
  graphql(kurl, {
    options: {
      pollInterval: 2000,
      fetchPolicy: "no-cache",
    },
  }),
  graphql(drainNode, {
    props: ({ mutate }) => ({
      drainNode: (name) => mutate({ variables: { name } })
    })
  }),
  graphql(deleteNode, {
    props: ({ mutate }) => ({
      deleteNode: (name) => mutate({ variables: { name } })
    })
  }),
)(ClusterNodes);
