import { z } from "zod";
import type { DeploymentObserver } from "./agent-capacity";
/** Narrow SDK port. Production composition must supply DescribeTasks/DescribeServices only,
 * using the API task's role; it must not reuse worker or provider credentials. */
export interface EcsObservationPort {
  describeTasks(input: { cluster: string; tasks: string[] }): Promise<unknown>;
  describeServices(input: {
    cluster: string;
    services: string[];
  }): Promise<unknown>;
}
const Task = z.object({
  tasks: z
    .array(
      z.object({
        taskArn: z.string(),
        taskDefinitionArn: z.string(),
        lastStatus: z.string(),
        desiredStatus: z.string(),
        group: z.string(),
        containers: z
          .array(
            z.object({
              name: z.string(),
              imageDigest: z.string().optional(),
              lastStatus: z.string(),
            }),
          )
          .max(10),
      }),
    )
    .length(1),
  failures: z.array(z.unknown()).max(0).optional(),
});
const Services = z.object({
  services: z
    .array(
      z.object({
        serviceArn: z.string(),
        taskDefinition: z.string(),
        status: z.string(),
      }),
    )
    .length(1),
  failures: z.array(z.unknown()).max(0).optional(),
});
export function createEcsDeploymentObserver(
  port: EcsObservationPort,
): DeploymentObserver {
  return async (taskArn, release) => {
    const service =
      /^(arn:aws:ecs:[a-z0-9-]+:\d{12}:)service\/([^/]+)\/([^/]+)$/.exec(
        release.serviceArn,
      );
    if (!service || !taskArn.startsWith(`${service[1]}task/${service[2]}/`))
      return false;
    const cluster = `${service[1]}cluster/${service[2]}`;
    const [tasks, services] = await Promise.all([
      port.describeTasks({ cluster, tasks: [taskArn] }),
      port.describeServices({ cluster, services: [release.serviceArn] }),
    ]);
    const task = Task.parse(tasks).tasks[0]!,
      installed = Services.parse(services).services[0]!;
    return (
      task.taskArn === taskArn &&
      task.taskDefinitionArn === release.taskDefinitionArn &&
      task.lastStatus === "RUNNING" &&
      task.desiredStatus === "RUNNING" &&
      task.group === `service:${service[3]}` &&
      installed.serviceArn === release.serviceArn &&
      installed.taskDefinition === release.taskDefinitionArn &&
      installed.status === "ACTIVE" &&
      task.containers.some(
        (c) =>
          c.name === "worker" &&
          c.lastStatus === "RUNNING" &&
          c.imageDigest === release.imageDigest,
      )
    );
  };
}
